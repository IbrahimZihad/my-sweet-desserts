import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ActorType,
  DepositType,
  OrderStatus,
  PaymentKind,
  PaymentStatus,
  Prisma,
  SlotStatus,
  UserRole,
} from "@prisma/client";
import { Cron } from "@nestjs/schedule";
import { randomInt } from "node:crypto";
import {
  PRIVACY_POLICY_VERSION,
  type BookingAnnouncementDto,
  type BookingAnnouncementsResponse,
  type BookingSummaryDto,
  type CreateBookingInput,
  type CreateBookingResponse,
} from "@cakeflow/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentsService } from "../payments/payments.service";
import { NotificationsService } from "../notifications/notifications.service";

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACTIVE_HOLD_STATUSES: OrderStatus[] = [
  OrderStatus.HELD,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.CONFIRMED,
];

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 1. Reserve capacity atomically (conditional UPDATE — no read-then-write race)
   * 2. Persist HELD order + deposit ledger row
   * 3. Create the Stripe PaymentIntent outside the DB transaction
   *
   * The order only becomes CONFIRMED when the signed webhook arrives.
   */
  async create(
    bakeryId: string,
    idempotencyKey: string | undefined,
    input: CreateBookingInput,
  ): Promise<CreateBookingResponse> {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "An Idempotency-Key header (8–128 chars) is required.",
      });
    }

    const existing = await this.prisma.order.findUnique({
      where: { bakeryId_idempotencyKey: { bakeryId, idempotencyKey } },
      include: { payments: { where: { kind: PaymentKind.DEPOSIT }, take: 1 } },
    });
    if (existing) return this.resume(existing);

    const [bakery, cake, slot] = await Promise.all([
      this.prisma.bakery.findUnique({ where: { id: bakeryId } }),
      this.prisma.cake.findFirst({ where: { id: input.cakeId, bakeryId, isActive: true } }),
      this.prisma.slot.findFirst({ where: { id: input.slotId, bakeryId } }),
    ]);

    if (!bakery?.isActive) {
      throw new NotFoundException({ code: "STORE_CLOSED", message: "This bakery is not taking orders." });
    }
    if (!cake) {
      throw new NotFoundException({ code: "CAKE_NOT_FOUND", message: "That cake is no longer available." });
    }
    if (!slot || slot.status !== SlotStatus.OPEN) {
      throw new NotFoundException({ code: "SLOT_NOT_FOUND", message: "That pickup slot is unavailable." });
    }

    const now = new Date();
    const leadHours = cake.leadTimeHours ?? bakery.leadTimeHours;
    if (slot.startsAt.getTime() < now.getTime() + leadHours * 3_600_000) {
      throw new ConflictException({
        code: "LEAD_TIME_NOT_MET",
        message: `This cake needs at least ${leadHours} hours notice. Please choose a later slot.`,
      });
    }
    if (slot.startsAt.getTime() > now.getTime() + bakery.maxAdvanceDays * 86_400_000) {
      throw new ConflictException({
        code: "TOO_FAR_AHEAD",
        message: `Bookings open ${bakery.maxAdvanceDays} days ahead.`,
      });
    }

    const totalCents = slot.priceOverrideCents ?? cake.priceCents;
    const depositCents = computeDeposit(totalCents, bakery.depositType, bakery.depositValue);

    let created: { orderId: string; paymentId: string; reference: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const reserved = await tx.$executeRaw`
          UPDATE Slot
             SET bookedCount = bookedCount + 1, updatedAt = UTC_TIMESTAMP(3)
           WHERE id = ${slot.id}
             AND bakeryId = ${bakeryId}
             AND status = 'OPEN'
             AND bookedCount < capacity`;
        if (reserved !== 1) {
          throw new ConflictException({
            code: "SLOT_FULL",
            message: "That slot was just taken. Please pick another time.",
          });
        }

        const customerId = await this.upsertCustomer(tx, bakeryId, input);
        const order = await tx.order.create({
          data: {
            reference: generateReference(),
            bakeryId,
            customerId,
            cakeId: cake.id,
            slotId: slot.id,
            status: OrderStatus.HELD,
            customerName: input.customer.name,
            customerEmail: input.customer.email,
            customerPhone: input.customer.phone,
            notes: input.notes?.slice(0, 500) ?? null,
            totalCents,
            depositCents,
            balanceDueCents: totalCents - depositCents,
            currency: bakery.currency,
            depositRefundable: bakery.depositRefundable,
            refundWindowHours: bakery.refundWindowHours,
            holdExpiresAt: new Date(now.getTime() + bakery.holdMinutes * 60_000),
            idempotencyKey,
            privacyPolicyVersion: PRIVACY_POLICY_VERSION,
            privacyAcceptedAt: now,
            healthDataConsentAt: input.healthDataConsent ? now : null,
          },
        });

        const payment = await tx.payment.create({
          data: {
            bakeryId,
            orderId: order.id,
            kind: PaymentKind.DEPOSIT,
            status: PaymentStatus.REQUIRES_PAYMENT,
            amountCents: depositCents,
            currency: bakery.currency,
            refundable: bakery.depositRefundable,
          },
        });

        await tx.orderEvent.create({
          data: {
            bakeryId,
            orderId: order.id,
            type: "CREATED",
            actorType: ActorType.CUSTOMER,
            metadata: { slotId: slot.id, cakeId: cake.id, depositCents },
          },
        });

        return { orderId: order.id, paymentId: payment.id, reference: order.reference };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await this.prisma.order.findUnique({
          where: { bakeryId_idempotencyKey: { bakeryId, idempotencyKey } },
          include: { payments: { where: { kind: PaymentKind.DEPOSIT }, take: 1 } },
        });
        if (duplicate) return this.resume(duplicate);
      }
      throw error;
    }

    let intent;
    try {
      intent = await this.payments.createDepositIntent({
        order: {
          id: created.orderId,
          reference: created.reference,
          bakeryId,
          depositCents,
          currency: bakery.currency,
          customerEmail: input.customer.email,
        },
        bakery: {
          name: bakery.name,
          stripeAccountId: bakery.stripeAccountId,
          stripeChargesEnabled: bakery.stripeChargesEnabled,
        },
      });
    } catch (error) {
      this.logger.error(`Stripe intent creation failed for order ${created.orderId}`, error as Error);
      await this.abortHold(created.orderId, slot.id, bakeryId);
      throw new BadGatewayException({
        code: "PAYMENT_PROVIDER_ERROR",
        message: "We could not start the deposit payment. Please try again.",
      });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: created.paymentId },
        data: { stripePaymentIntentId: intent.id },
      });
      return tx.order.findUniqueOrThrow({ where: { id: created.orderId } });
    });

    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status,
      depositCents: order.depositCents,
      totalCents: order.totalCents,
      currency: order.currency,
      clientSecret: intent.client_secret ?? "",
      holdExpiresAt: order.holdExpiresAt.toISOString(),
    };
  }

  async getByReference(bakeryId: string, reference: string, email: string): Promise<BookingSummaryDto> {
    const order = await this.prisma.order.findFirst({
      where: { bakeryId, reference, customerEmail: email.toLowerCase().trim() },
      include: {
        cake: { select: { name: true } },
        slot: { select: { startsAt: true, endsAt: true } },
        payments: { where: { kind: PaymentKind.DEPOSIT }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    // Same error for missing order and wrong email — prevents reference enumeration.
    if (!order) {
      throw new NotFoundException({ code: "BOOKING_NOT_FOUND", message: "Booking not found." });
    }
    return toSummary(order);
  }

  async cancelByCustomer(bakeryId: string, reference: string, email: string) {
    const order = await this.prisma.order.findFirst({
      where: { bakeryId, reference, customerEmail: email.toLowerCase().trim() },
      include: { slot: true, payments: { where: { kind: PaymentKind.DEPOSIT } } },
    });
    if (!order) {
      throw new NotFoundException({ code: "BOOKING_NOT_FOUND", message: "Booking not found." });
    }
    if (!ACTIVE_HOLD_STATUSES.includes(order.status)) {
      throw new ConflictException({ code: "BOOKING_NOT_ACTIVE", message: "This booking is no longer active." });
    }

    const paidDeposit = order.payments.some((payment) => payment.status === PaymentStatus.SUCCEEDED);
    const refundable = paidDeposit && this.isRefundEligible(order);
    const refund = refundable ? await this.payments.refundDeposit(order.id) : null;

    await this.finalizeCancellation({
      order,
      reason: "Cancelled by customer",
      actorType: ActorType.CUSTOMER,
      refunded: Boolean(refund?.refunded),
    });

    return {
      reference: order.reference,
      status: OrderStatus.CANCELLED,
      refunded: Boolean(refund?.refunded),
      refundedCents: refund?.amountCents ?? 0,
    };
  }

  async cancelByAdmin(
    bakeryId: string,
    orderId: string,
    actorId: string,
    options: { reason?: string; refund?: boolean },
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, bakeryId },
      include: { slot: true, payments: { where: { kind: PaymentKind.DEPOSIT } } },
    });
    if (!order) throw new NotFoundException({ code: "BOOKING_NOT_FOUND", message: "Booking not found." });
    if (!ACTIVE_HOLD_STATUSES.includes(order.status)) {
      throw new ConflictException({ code: "BOOKING_NOT_ACTIVE", message: "This booking is already closed." });
    }

    const paidDeposit = order.payments.some((p) => p.status === PaymentStatus.SUCCEEDED);
    const shouldRefund = options.refund ?? (paidDeposit && this.isRefundEligible(order));
    const refund = shouldRefund && paidDeposit ? await this.payments.refundDeposit(order.id) : null;

    await this.finalizeCancellation({
      order,
      reason: options.reason?.slice(0, 500) ?? "Cancelled by bakery",
      actorType: ActorType.BAKER,
      actorId,
      refunded: Boolean(refund?.refunded),
    });

    return { ok: true, refunded: Boolean(refund?.refunded), refundedCents: refund?.amountCents ?? 0 };
  }

  async listAdmin(
    bakeryId: string,
    query: {
      status?: OrderStatus;
      from?: string;
      to?: string;
      search?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const where: Prisma.OrderWhereInput = {
      bakeryId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search } },
              { customerName: { contains: query.search } },
              { customerEmail: { contains: query.search } },
            ],
          }
        : {}),
    };

    const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (Math.max(query.page, 1) - 1) * pageSize,
        take: pageSize,
        include: {
          cake: { select: { name: true, sizeLabel: true } },
          slot: { select: { startsAt: true, endsAt: true } },
          payments: { where: { kind: PaymentKind.DEPOSIT }, take: 1 },
        },
      }),
    ]);

    return {
      total,
      page: Math.max(query.page, 1),
      pageSize,
      rows: rows.map((row) => ({
        ...toSummary({
          ...row,
          cake: row.cake,
          slot: row.slot,
          payments: row.payments,
        }),
        balanceDueCents: row.balanceDueCents,
      })),
    };
  }

  /**
   * New bookings since a cursor, for the dashboard's spoken announcements.
   * Scoped to the tenant and capped so a stale cursor cannot stream PII.
   */
  async listAnnouncements(bakeryId: string, since: Date): Promise<BookingAnnouncementsResponse> {
    const now = new Date();
    const floor = new Date(now.getTime() - 15 * 60_000);
    const cursor = since.getTime() > floor.getTime() ? since : floor;
    const batchSize = 25;

    const [bakery, rows] = await this.prisma.$transaction([
      this.prisma.bakery.findUniqueOrThrow({
        where: { id: bakeryId },
        select: { timezone: true },
      }),
      this.prisma.order.findMany({
        where: {
          bakeryId,
          createdAt: { gt: cursor },
          // Never read out an abandoned hold that already expired or a booking
          // the customer cancelled, and never a record that has been erased.
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] },
          anonymisedAt: null,
        },
        orderBy: { createdAt: "asc" },
        take: batchSize + 1,
        select: {
          id: true,
          reference: true,
          customerName: true,
          status: true,
          createdAt: true,
          cake: { select: { name: true } },
          slot: { select: { startsAt: true } },
        },
      }),
    ]);

    const hasMore = rows.length > batchSize;
    const page = hasMore ? rows.slice(0, batchSize) : rows;

    const announcements: BookingAnnouncementDto[] = page.map((row) => ({
      id: row.id,
      reference: row.reference,
      customerFirstName: row.customerName.trim().split(/\s+/)[0] || "Guest",
      cakeName: row.cake.name,
      slotStartsAt: row.slot.startsAt.toISOString(),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));

    return { announcements, serverTime: now.toISOString(), timezone: bakery.timezone, hasMore };
  }

  /** Releases capacity for holds that were never paid. Runs every minute. */
  @Cron("*/1 * * * *", { name: "expire-booking-holds" })
  async expireStaleHolds(): Promise<void> {
    const stale = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.HELD, OrderStatus.PENDING_PAYMENT] },
        holdExpiresAt: { lt: new Date() },
      },
      select: {
        id: true,
        bakeryId: true,
        slotId: true,
        reference: true,
        customerEmail: true,
        customerName: true,
        bakery: { select: { name: true, timezone: true } },
      },
      take: 100,
    });
    if (!stale.length) return;

    for (const order of stale) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.order.updateMany({
            where: { id: order.id, status: { in: [OrderStatus.HELD, OrderStatus.PENDING_PAYMENT] } },
            data: { status: OrderStatus.EXPIRED, cancelledAt: new Date() },
          });
          if (claimed.count !== 1) return; // webhook won the race

          await tx.payment.updateMany({
            where: {
              orderId: order.id,
              status: { in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING, PaymentStatus.FAILED] },
            },
            data: { status: PaymentStatus.CANCELLED },
          });
          await tx.$executeRaw`
            UPDATE Slot SET bookedCount = GREATEST(bookedCount - 1, 0), updatedAt = UTC_TIMESTAMP(3)
            WHERE id = ${order.slotId} AND bakeryId = ${order.bakeryId}`;
          await tx.orderEvent.create({
            data: {
              bakeryId: order.bakeryId,
              orderId: order.id,
              type: "EXPIRED",
              actorType: ActorType.SYSTEM,
              metadata: { reason: "hold_timeout" },
            },
          });
          await this.notifications.enqueue(tx, {
            bakeryId: order.bakeryId,
            orderId: order.id,
            toEmail: order.customerEmail,
            template: "BOOKING_EXPIRED",
            payload: {
              reference: order.reference,
              customerName: order.customerName,
              bakeryName: order.bakery.name,
              timezone: order.bakery.timezone,
            },
          });
        });
      } catch (error) {
        this.logger.error(`Failed to expire order ${order.id}`, error as Error);
      }
    }
  }

  private async resume(order: {
    id: string;
    reference: string;
    status: OrderStatus;
    depositCents: number;
    totalCents: number;
    currency: string;
    holdExpiresAt: Date;
    payments: Array<{ stripePaymentIntentId: string | null }>;
  }): Promise<CreateBookingResponse> {
    if (order.status === OrderStatus.EXPIRED || order.status === OrderStatus.CANCELLED) {
      throw new GoneException({
        code: "HOLD_EXPIRED",
        message: "This booking hold expired. Please choose a slot again.",
      });
    }

    if (order.status === OrderStatus.CONFIRMED) {
      return {
        orderId: order.id,
        reference: order.reference,
        status: order.status,
        depositCents: order.depositCents,
        totalCents: order.totalCents,
        currency: order.currency,
        clientSecret: "",
        holdExpiresAt: order.holdExpiresAt.toISOString(),
      };
    }

    const intentId = order.payments[0]?.stripePaymentIntentId;
    if (!intentId) {
      throw new ConflictException({
        code: "PAYMENT_INITIALISING",
        message: "Payment is still being prepared. Please retry in a moment.",
      });
    }
    const clientSecret = await this.payments.retrieveClientSecret(intentId);
    if (!clientSecret) {
      throw new GoneException({
        code: "PAYMENT_INTENT_UNAVAILABLE",
        message: "This payment session is no longer available. Please book again.",
      });
    }

    return {
      orderId: order.id,
      reference: order.reference,
      status: order.status,
      depositCents: order.depositCents,
      totalCents: order.totalCents,
      currency: order.currency,
      clientSecret,
      holdExpiresAt: order.holdExpiresAt.toISOString(),
    };
  }

  private async upsertCustomer(
    tx: Prisma.TransactionClient,
    bakeryId: string,
    input: CreateBookingInput,
  ): Promise<string> {
    const updated = await tx.user.updateMany({
      where: { bakeryId, email: input.customer.email, role: UserRole.CUSTOMER },
      data: { name: input.customer.name, phone: input.customer.phone },
    });
    if (updated.count > 0) {
      const user = await tx.user.findUniqueOrThrow({
        where: { bakeryId_email: { bakeryId, email: input.customer.email } },
        select: { id: true },
      });
      return user.id;
    }

    const existing = await tx.user.findUnique({
      where: { bakeryId_email: { bakeryId, email: input.customer.email } },
      select: { role: true },
    });
    if (existing) {
      throw new ConflictException({
        code: "EMAIL_IN_USE",
        message: "This email is already used by a staff account. Please use a different email.",
      });
    }

    const created = await tx.user.create({
      data: {
        bakeryId,
        email: input.customer.email,
        name: input.customer.name,
        phone: input.customer.phone,
        role: UserRole.CUSTOMER,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async finalizeCancellation(params: {
    order: {
      id: string;
      bakeryId: string;
      slotId: string;
      reference: string;
      customerEmail: string;
      customerName: string;
      cakeId: string;
      slot: { startsAt: Date };
    };
    reason: string;
    actorType: ActorType;
    actorId?: string;
    refunded: boolean;
  }): Promise<void> {
    const { order } = params;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: { in: ACTIVE_HOLD_STATUSES } },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: params.reason,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ code: "BOOKING_ALREADY_CLOSED", message: "Booking was already cancelled." });
      }

      await tx.$executeRaw`
        UPDATE Slot SET bookedCount = GREATEST(bookedCount - 1, 0), updatedAt = UTC_TIMESTAMP(3)
        WHERE id = ${order.slotId} AND bakeryId = ${order.bakeryId}`;

      await tx.payment.updateMany({
        where: {
          orderId: order.id,
          status: { in: [PaymentStatus.REQUIRES_PAYMENT, PaymentStatus.PROCESSING, PaymentStatus.FAILED] },
        },
        data: { status: PaymentStatus.CANCELLED },
      });

      await tx.orderEvent.create({
        data: {
          bakeryId: order.bakeryId,
          orderId: order.id,
          type: params.actorType === ActorType.BAKER ? "CANCELLED_BY_BAKER" : "CANCELLED_BY_CUSTOMER",
          actorType: params.actorType,
          actorId: params.actorId,
          metadata: { reason: params.reason, refunded: params.refunded },
        },
      });

      const bakery = await tx.bakery.findUniqueOrThrow({
        where: { id: order.bakeryId },
        select: { name: true, timezone: true },
      });
      const cake = await tx.cake.findUnique({ where: { id: order.cakeId }, select: { name: true } });

      await this.notifications.enqueue(tx, {
        bakeryId: order.bakeryId,
        orderId: order.id,
        toEmail: order.customerEmail,
        template: "BOOKING_CANCELLED",
        payload: {
          reference: order.reference,
          customerName: order.customerName,
          bakeryName: bakery.name,
          cakeName: cake?.name ?? "your cake",
          startsAt: order.slot.startsAt.toISOString(),
          timezone: bakery.timezone,
          refunded: params.refunded,
        },
      });
    });
  }

  private isRefundEligible(order: {
    depositRefundable: boolean;
    refundWindowHours: number;
    slot: { startsAt: Date };
  }): boolean {
    if (!order.depositRefundable) return false;
    const cutoff = order.slot.startsAt.getTime() - order.refundWindowHours * 3_600_000;
    return Date.now() <= cutoff;
  }

  private async abortHold(orderId: string, slotId: string, bakeryId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.HELD },
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (claimed.count !== 1) return;

      await tx.payment.updateMany({
        where: { orderId },
        data: {
          status: PaymentStatus.FAILED,
          failureCode: "INTENT_CREATION_FAILED",
          failureMessage: "Stripe PaymentIntent could not be created.",
        },
      });
      await tx.$executeRaw`
        UPDATE Slot SET bookedCount = GREATEST(bookedCount - 1, 0), updatedAt = UTC_TIMESTAMP(3)
        WHERE id = ${slotId} AND bakeryId = ${bakeryId}`;
      await tx.orderEvent.create({
        data: {
          bakeryId,
          orderId,
          type: "PAYMENT_FAILED",
          actorType: ActorType.SYSTEM,
          metadata: { reason: "intent_creation_failed" },
        },
      });
    });
  }

}

function computeDeposit(totalCents: number, type: DepositType, value: number): number {
  if (totalCents <= 0) return 0;
  if (type === DepositType.FLAT) return Math.min(Math.max(value, 0), totalCents);
  const percentage = Math.round((totalCents * Math.min(Math.max(value, 0), 10_000)) / 10_000);
  return Math.min(Math.max(percentage, 100), totalCents);
}

function generateReference(): string {
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `CF-${suffix}`;
}

function toSummary(order: {
  id: string;
  reference: string;
  status: OrderStatus;
  cake: { name: string };
  slot: { startsAt: Date; endsAt: Date };
  totalCents: number;
  depositCents: number;
  depositRefundable: boolean;
  customerName: string;
  customerEmail: string;
  createdAt: Date;
  payments: Array<{ status: PaymentStatus }>;
}): BookingSummaryDto {
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    cakeName: order.cake.name,
    slotStartsAt: order.slot.startsAt.toISOString(),
    slotEndsAt: order.slot.endsAt.toISOString(),
    totalCents: order.totalCents,
    depositCents: order.depositCents,
    depositStatus: order.payments[0]?.status ?? PaymentStatus.REQUIRES_PAYMENT,
    depositRefundable: order.depositRefundable,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    createdAt: order.createdAt.toISOString(),
  };
}
