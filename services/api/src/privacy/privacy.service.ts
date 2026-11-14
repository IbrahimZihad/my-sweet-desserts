import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OrderStatus, Prisma, PrivacyRequestStatus, PrivacyRequestType, UserRole } from "@prisma/client";
import { Cron, CronExpression } from "@nestjs/schedule";
import { createHash } from "node:crypto";
import {
  PRIVACY_POLICY_VERSION,
  type PrivacyErasureInput,
  type PrivacyErasureResponse,
  type PrivacyExportResponse,
  type PrivacyRequestInput,
  type PrivacyRequestSummaryDto,
} from "@cakeflow/contracts";
import { PrismaService } from "../prisma/prisma.service";

type Db = Prisma.TransactionClient;

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.HELD,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.CONFIRMED,
];
const CLOSED_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.EXPIRED,
  OrderStatus.COMPLETED,
];

const RETENTION_NOTE =
  "We retained the booking reference, order amounts, payment identifiers, timestamps and tax records " +
  "because EU/UK accounting law and our legitimate interest in defending legal claims require them. " +
  "They no longer contain your name, email, phone number or free-text notes.";

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** GDPR Art. 15 (access) and Art. 20 (portability). */
  async exportData(bakeryId: string, input: PrivacyRequestInput): Promise<PrivacyExportResponse> {
    const verified = await this.findVerifiedOrder(bakeryId, input);
    const now = new Date();

    const [bakery, customer, orders] = await Promise.all([
      this.prisma.bakery.findUniqueOrThrow({
        where: { id: bakeryId },
        select: { name: true, email: true },
      }),
      this.prisma.user.findUnique({
        where: { id: verified.customerId },
        select: { name: true, phone: true },
      }),
      this.prisma.order.findMany({
        where: { bakeryId, customerEmail: input.email },
        orderBy: { createdAt: "asc" },
        include: {
          cake: { select: { name: true } },
          slot: { select: { startsAt: true } },
          payments: true,
        },
      }),
    ]);

    // Accountability without retaining another copy of the email in the log.
    await this.prisma.privacyRequest.create({
      data: {
        bakeryId,
        type: PrivacyRequestType.EXPORT,
        status: PrivacyRequestStatus.COMPLETED,
        reference: verified.reference,
        orderId: verified.id,
        subjectEmailHash: hashEmail(input.email),
        requestedAt: now,
        completedAt: now,
      },
    });

    return {
      exportedAt: now.toISOString(),
      policyVersion: PRIVACY_POLICY_VERSION,
      bakery,
      subject: {
        name: customer?.name ?? verified.customerName,
        email: input.email,
        phone: customer?.phone ?? null,
      },
      orders: orders.map((order) => ({
        reference: order.reference,
        status: order.status,
        cakeName: order.cake.name,
        slotStartsAt: order.slot.startsAt.toISOString(),
        totalCents: order.totalCents,
        depositCents: order.depositCents,
        currency: order.currency,
        notes: order.notes,
        cancellationReason: order.cancellationReason,
        createdAt: order.createdAt.toISOString(),
        privacyPolicyVersion: order.privacyPolicyVersion,
        privacyAcceptedAt: order.privacyAcceptedAt?.toISOString() ?? null,
        healthDataConsentAt: order.healthDataConsentAt?.toISOString() ?? null,
      })),
      payments: orders.flatMap((order) =>
        order.payments.map((payment) => ({
          orderReference: order.reference,
          kind: payment.kind,
          status: payment.status,
          amountCents: payment.amountCents,
          refundedCents: payment.refundedCents,
          currency: payment.currency,
          createdAt: payment.createdAt.toISOString(),
        })),
      ),
      notice:
        "This export contains the personal data we hold about you. It is provided under GDPR Articles 15 " +
        "and 20. You can request rectification, restriction, erasure or object to processing by using the " +
        "privacy request page or contacting the bakery.",
    };
  }

  /** GDPR Art. 17 (erasure), implemented as anonymisation of PII. */
  async eraseData(bakeryId: string, input: PrivacyErasureInput): Promise<PrivacyErasureResponse> {
    const verified = await this.findVerifiedOrder(bakeryId, input);
    const now = new Date();

    // Do not destroy data needed to deliver an upcoming booking. The customer
    // can cancel first (which may trigger a refund) or come back after pickup.
    const active = await this.prisma.order.count({
      where: {
        bakeryId,
        customerEmail: input.email,
        status: { in: ACTIVE_STATUSES },
        slot: { startsAt: { gt: now } },
      },
    });
    if (active > 0) {
      throw new ConflictException({
        code: "ACTIVE_BOOKINGS",
        message:
          "You have an upcoming booking. Cancel it first, or request erasure after pickup, so we can still fulfil your order.",
      });
    }

    const orders = await this.prisma.order.findMany({
      where: { bakeryId, customerEmail: input.email },
      select: { id: true, bakeryId: true, reference: true, customerId: true, anonymisedAt: true },
      orderBy: { createdAt: "asc" },
    });

    const result = await this.prisma.$transaction(
      async (tx) => {
        const request = await tx.privacyRequest.create({
          data: {
            bakeryId,
            type: PrivacyRequestType.ERASURE,
            status: PrivacyRequestStatus.COMPLETED,
            reference: verified.reference,
            orderId: verified.id,
            subjectEmailHash: hashEmail(input.email),
            reason: input.reason ?? null,
            requestedAt: now,
            completedAt: now,
          },
          select: { id: true },
        });

        let anonymised = 0;
        for (const order of orders) {
          if (order.anonymisedAt) continue;
          await anonymiseOrder(tx, order, request.id, now);
          anonymised += 1;
        }

        await anonymiseCustomer(tx, bakeryId, verified.customerId, now);
        return { requestId: request.id, anonymised };
      },
      { timeout: 15_000 },
    );

    return {
      erased: true,
      confirmationId: result.requestId,
      anonymisedOrders: result.anonymised,
      requestedAt: now.toISOString(),
      retained: RETENTION_NOTE,
    };
  }

  async listRequests(
    bakeryId: string,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; page: number; pageSize: number; rows: PrivacyRequestSummaryDto[] }> {
    const size = Math.min(Math.max(pageSize, 1), 100);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.privacyRequest.count({ where: { bakeryId } }),
      this.prisma.privacyRequest.findMany({
        where: { bakeryId },
        orderBy: { requestedAt: "desc" },
        skip: (Math.max(page, 1) - 1) * size,
        take: size,
        select: {
          id: true,
          type: true,
          status: true,
          reference: true,
          subjectEmailHash: true,
          requestedAt: true,
          completedAt: true,
        },
      }),
    ]);

    return {
      total,
      page: Math.max(page, 1),
      pageSize: size,
      rows: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        reference: row.reference,
        subjectEmailHashPrefix: row.subjectEmailHash.slice(0, 12),
        requestedAt: row.requestedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Storage limitation (GDPR Art. 5(1)(e)). Runs nightly and can be triggered
   * manually by an owner. Only closed orders older than the bakery's retention
   * window are touched; the financial ledger stays intact.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: "privacy-retention" })
  async runRetention(bakeryId?: string): Promise<{
    anonymisedOrders: number;
    redactedStripeEvents: number;
    deletedOutbox: number;
    deletedSessions: number;
  }> {
    const now = new Date();
    const bakeries = await this.prisma.bakery.findMany({
      where: bakeryId ? { id: bakeryId } : {},
      select: { id: true, piiRetentionDays: true },
    });

    let anonymisedOrders = 0;
    for (const bakery of bakeries) {
      const cutoff = new Date(now.getTime() - bakery.piiRetentionDays * 86_400_000);
      const stale = await this.prisma.order.findMany({
        where: {
          bakeryId: bakery.id,
          createdAt: { lt: cutoff },
          status: { in: CLOSED_STATUSES },
          anonymisedAt: null,
        },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, bakeryId: true, reference: true, customerId: true },
      });

      for (const order of stale) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await anonymiseOrder(tx, order, "RETENTION", now);
            await anonymiseCustomer(tx, order.bakeryId, order.customerId, now);
          });
          anonymisedOrders += 1;
        } catch (error) {
          this.logger.error(`Retention anonymisation failed for order ${order.id}`, error as Error);
        }
      }
    }

    // Stripe event payloads can contain customer details. Keep the event ID,
    // type and processing metadata for idempotency, but redact the payload.
    const stripeDays = this.config.get<number>("STRIPE_EVENT_RETENTION_DAYS") ?? 30;
    const stripeCutoff = new Date(now.getTime() - stripeDays * 86_400_000);
    const redacted = await this.prisma.stripeEvent.updateMany({
      where: { processedAt: { lt: stripeCutoff } },
      data: { payload: { redacted: true, reason: "retention" } as Prisma.InputJsonValue },
    });

    const outboxCutoff = new Date(now.getTime() - 30 * 86_400_000);
    const deletedOutbox = await this.prisma.emailOutbox.deleteMany({
      where: { createdAt: { lt: outboxCutoff }, status: { in: ["SENT", "FAILED"] } },
    });

    const deletedSessions = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return {
      anonymisedOrders,
      redactedStripeEvents: redacted.count,
      deletedOutbox: deletedOutbox.count,
      deletedSessions: deletedSessions.count,
    };
  }

  private async findVerifiedOrder(bakeryId: string, input: PrivacyRequestInput) {
    const order = await this.prisma.order.findFirst({
      where: {
        bakeryId,
        reference: input.reference,
        customerEmail: input.email,
      },
      select: {
        id: true,
        reference: true,
        customerId: true,
        customerName: true,
        customerEmail: true,
      },
    });
    // Same response for a missing reference and a wrong email, to avoid
    // turning the data-subject request form into a booking enumeration tool.
    if (!order) {
      throw new NotFoundException({ code: "BOOKING_NOT_FOUND", message: "Booking not found." });
    }
    return order;
  }
}

async function anonymiseOrder(
  tx: Db,
  order: { id: string; bakeryId: string; reference: string },
  requestId: string,
  now: Date,
): Promise<void> {
  await tx.order.update({
    where: { id: order.id },
    data: {
      customerName: "Erased customer",
      customerEmail: `erased+${order.id}@invalid.local`,
      customerPhone: "",
      notes: null,
      cancellationReason: null,
      anonymisedAt: now,
    },
  });

  // The outbox is a delivery queue, not a financial record. Remove queued and
  // sent emails so the address is not retained beyond the erasure request.
  await tx.emailOutbox.deleteMany({ where: { orderId: order.id } });

  // Stripe event payloads can embed the order metadata. Redact them now rather
  // than waiting for the 30-day retention window.
  await tx.$executeRaw`
    UPDATE StripeEvent
       SET payload = JSON_OBJECT('redacted', true, 'reason', 'erasure')
     WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.data.object.metadata.orderId')) = ${order.id}`;

  // Admin cancellation reasons are free text and can contain PII.
  await tx.orderEvent.updateMany({
    where: {
      orderId: order.id,
      type: { in: ["CANCELLED_BY_BAKER", "CANCELLED_BY_CUSTOMER"] },
    },
    data: { metadata: { redacted: true } as Prisma.InputJsonValue },
  });

  await tx.orderEvent.create({
    data: {
      bakeryId: order.bakeryId,
      orderId: order.id,
      type: "DATA_ERASED",
      actorType: "SYSTEM",
      metadata: {
        privacyRequestId: requestId,
        retained: ["amounts", "paymentIds", "timestamps", "reference"],
      },
    },
  });
}

async function anonymiseCustomer(
  tx: Db,
  bakeryId: string,
  customerId: string,
  now: Date,
): Promise<void> {
  // Only erase the customer record once every order they own has been
  // anonymised, otherwise an active/recent order would lose its link.
  const remaining = await tx.order.count({
    where: { bakeryId, customerId, anonymisedAt: null },
  });
  if (remaining > 0) return;

  const customer = await tx.user.findUnique({
    where: { id: customerId },
    select: { id: true, role: true },
  });
  if (!customer || customer.role !== UserRole.CUSTOMER) return;

  await tx.session.updateMany({
    where: { userId: customerId, revokedAt: null },
    data: { revokedAt: now },
  });

  await tx.user.update({
    where: { id: customerId },
    data: {
      name: "Erased customer",
      email: `erased+${customer.id}@invalid.local`,
      phone: null,
      passwordHash: null,
      isActive: false,
    },
  });
}

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}
