import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OrderStatus, PaymentKind, PaymentStatus, Prisma } from "@prisma/client";
import Stripe from "stripe";
import { PrismaService } from "../prisma/prisma.service";

interface DepositIntentInput {
  order: {
    id: string;
    reference: string;
    bakeryId: string;
    depositCents: number;
    currency: string;
    customerEmail: string;
  };
  bakery: {
    name: string;
    stripeAccountId: string | null;
    stripeChargesEnabled: boolean;
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe;
  private readonly platformFeeBps: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.config.getOrThrow<string>("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
      maxNetworkRetries: 2,
    });
    this.platformFeeBps = this.config.get<number>("STRIPE_PLATFORM_FEE_BPS") ?? 0;
  }

  /**
   * Creates a destination-charge PaymentIntent for the deposit. The booking is
   * NOT confirmed here — only the signed webhook may confirm it.
   */
  async createDepositIntent(input: DepositIntentInput): Promise<Stripe.PaymentIntent> {
    const { order, bakery } = input;
    const destination =
      bakery.stripeAccountId && bakery.stripeChargesEnabled ? bakery.stripeAccountId : null;

    const applicationFee =
      destination && this.platformFeeBps > 0
        ? Math.round((order.depositCents * this.platformFeeBps) / 10_000)
        : undefined;

    return this.stripe.paymentIntents.create(
      {
        amount: order.depositCents,
        currency: order.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        receipt_email: order.customerEmail,
        description: `Deposit for ${order.reference} — ${bakery.name}`,
        metadata: {
          orderId: order.id,
          bakeryId: order.bakeryId,
          reference: order.reference,
          purpose: "DEPOSIT",
        },
        ...(destination
          ? {
              transfer_data: { destination },
              ...(applicationFee ? { application_fee_amount: applicationFee } : {}),
            }
          : {}),
      },
      { idempotencyKey: `deposit:${order.id}` },
    );
  }

  async retrieveClientSecret(paymentIntentId: string): Promise<string | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return intent.client_secret;
    } catch (error) {
      this.logger.warn(`Could not retrieve PaymentIntent ${paymentIntentId}: ${String(error)}`);
      return null;
    }
  }

  async refundDeposit(orderId: string, reason: "requested_by_customer" | "duplicate" | "fraudulent" = "requested_by_customer") {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, kind: PaymentKind.DEPOSIT, status: PaymentStatus.SUCCEEDED },
      include: {
        order: {
          select: {
            id: true,
            bakeryId: true,
            depositRefundedAt: true,
            bakery: { select: { stripeAccountId: true, stripeChargesEnabled: true } },
          },
        },
      },
    });

    if (!payment?.stripePaymentIntentId) {
      throw new NotFoundException({
        code: "NO_REFUNDABLE_PAYMENT",
        message: "No captured deposit was found for this booking.",
      });
    }
    if (payment.refundedCents >= payment.amountCents) {
      return { refunded: true, alreadyRefunded: true, amountCents: payment.refundedCents };
    }

    const isDestinationCharge = Boolean(
      payment.order.bakery.stripeAccountId && payment.order.bakery.stripeChargesEnabled,
    );
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: payment.stripePaymentIntentId,
        amount: payment.amountCents - payment.refundedCents,
        reason,
        ...(isDestinationCharge
          ? {
              reverse_transfer: true,
              refund_application_fee: this.platformFeeBps > 0,
            }
          : {}),
        metadata: { orderId, purpose: "DEPOSIT_REFUND" },
      },
      { idempotencyKey: `refund:${payment.id}` },
    );

    const refundAmount = payment.amountCents - payment.refundedCents;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.REFUNDED,
          stripeRefundId: refund.id,
          refundedCents: payment.amountCents,
          refundedAt: new Date(),
        },
      });
      await tx.payment.create({
        data: {
          bakeryId: payment.bakeryId,
          orderId,
          kind: PaymentKind.REFUND,
          status: PaymentStatus.REFUNDED,
          amountCents: refundAmount,
          currency: payment.currency,
          stripeRefundId: refund.id,
          stripePaymentIntentId: null,
          refundable: false,
          refundedCents: refundAmount,
          refundedAt: new Date(),
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { depositRefundedAt: new Date() },
      });
      await tx.orderEvent.create({
        data: {
          bakeryId: payment.order.bakeryId,
          orderId,
          type: "DEPOSIT_REFUNDED",
          actorType: "SYSTEM",
          metadata: { refundId: refund.id, amountCents: payment.amountCents },
        },
      });
    });

    return { refunded: true, alreadyRefunded: false, amountCents: payment.amountCents };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!signature) {
      throw new BadRequestException({ code: "STRIPE_SIGNATURE_MISSING", message: "Missing Stripe signature." });
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.getOrThrow<string>("STRIPE_WEBHOOK_SECRET"),
      );
    } catch (error) {
      this.logger.warn(`Rejected Stripe webhook: ${error instanceof Error ? error.message : "invalid signature"}`);
      throw new BadRequestException({ code: "STRIPE_SIGNATURE_INVALID", message: "Invalid Stripe signature." });
    }

    const stored = await this.claimEvent(event);
    if (!stored) return { received: true, duplicate: true };

    try {
      await this.processEvent(event);
      await this.prisma.stripeEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date(), error: null },
      });
      return { received: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.stripeEvent.update({
        where: { id: stored.id },
        data: { error: message.slice(0, 2000), processingAt: null },
      });
      this.logger.error(`Stripe event ${event.id} failed: ${message}`);
      // Non-2xx makes Stripe retry with backoff.
      throw error;
    }
  }

  /**
   * Insert-or-claim with a processing lease. Concurrent duplicate deliveries
   * return null instead of double-processing the event.
   */
  private async claimEvent(event: Stripe.Event) {
    const payload = JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
    const existing = await this.prisma.stripeEvent.findUnique({
      where: { stripeEventId: event.id },
      select: { id: true, processedAt: true, processingAt: true },
    });

    if (!existing) {
      try {
        return await this.prisma.stripeEvent.create({
          data: { stripeEventId: event.id, type: event.type, payload, processingAt: new Date() },
          select: { id: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return null; // another delivery won the insert
        }
        throw error;
      }
    }

    if (existing.processedAt) return null;
    const stale = !existing.processingAt || existing.processingAt < new Date(Date.now() - 5 * 60_000);
    if (!stale) return null;

    const claimed = await this.prisma.stripeEvent.updateMany({
      where: {
        id: existing.id,
        processedAt: null,
        OR: [{ processingAt: null }, { processingAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
      },
      data: { processingAt: new Date(), attempts: { increment: 1 } },
    });
    return claimed.count === 1 ? { id: existing.id } : null;
  }

  private async processEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "payment_intent.succeeded":
        await this.onDepositSucceeded(event.data.object);
        return;
      case "payment_intent.payment_failed":
        await this.onDepositFailed(event.data.object);
        return;
      case "payment_intent.canceled":
        await this.onIntentCanceled(event.data.object);
        return;
      case "charge.refunded":
        await this.onChargeRefunded(event.data.object);
        return;
      default:
        this.logger.debug(`Ignoring Stripe event ${event.type}`);
    }
  }

  private async onDepositSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.findDepositPayment(intent);
    if (!payment) {
      // Do not acknowledge money we cannot account for; let Stripe retry.
      throw new Error(`No payment row for PaymentIntent ${intent.id}`);
    }

    if (intent.amount !== payment.amountCents || intent.currency.toUpperCase() !== payment.currency) {
      throw new Error(`Amount/currency mismatch for PaymentIntent ${intent.id}`);
    }
    if (intent.metadata.orderId && intent.metadata.orderId !== payment.orderId) {
      throw new Error(`Order metadata mismatch for PaymentIntent ${intent.id}`);
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id: payment.orderId,
          status: { in: [OrderStatus.HELD, OrderStatus.PENDING_PAYMENT] },
        },
        data: { status: OrderStatus.CONFIRMED, confirmedAt: new Date() },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          stripePaymentIntentId: intent.id,
          stripeChargeId:
            typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id,
          failureCode: null,
          failureMessage: null,
        },
      });

      if (claimed.count === 0) {
        const current = await tx.order.findUnique({
          where: { id: payment.orderId },
          select: { status: true },
        });
        return {
          needsRefund:
            current?.status === OrderStatus.EXPIRED || current?.status === OrderStatus.CANCELLED,
        };
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: payment.orderId },
        include: {
          cake: { select: { name: true } },
          slot: true,
          bakery: { select: { name: true, timezone: true } },
        },
      });

      await tx.orderEvent.createMany({
        data: [
          {
            bakeryId: order.bakeryId,
            orderId: order.id,
            type: "PAYMENT_SUCCEEDED",
            actorType: "STRIPE",
            metadata: { paymentIntentId: intent.id, amountCents: payment.amountCents },
          },
          {
            bakeryId: order.bakeryId,
            orderId: order.id,
            type: "CONFIRMED",
            actorType: "SYSTEM",
          },
        ],
      });

      await tx.emailOutbox.create({
        data: {
          bakeryId: order.bakeryId,
          orderId: order.id,
          toEmail: order.customerEmail,
          template: "BOOKING_CONFIRMED",
          payload: {
            reference: order.reference,
            customerName: order.customerName,
            bakeryName: order.bakery.name,
            cakeName: order.cake.name,
            startsAt: order.slot.startsAt.toISOString(),
            timezone: order.bakery.timezone,
            depositCents: order.depositCents,
            currency: order.currency,
          },
        },
      });

      return { needsRefund: false };
    });

    if (outcome.needsRefund) {
      // Payment succeeded after the hold expired (or after cancellation).
      // Capture the money, then immediately return it — never keep an unbooked deposit.
      this.logger.warn(`Late payment for order ${payment.orderId}; refunding deposit.`);
      await this.refundDeposit(payment.orderId, "duplicate");
    }
  }

  private async onDepositFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.findDepositPayment(intent);
    if (!payment) return;

    const failure = intent.last_payment_error;
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          stripePaymentIntentId: intent.id,
          failureCode: failure?.code?.slice(0, 120) ?? null,
          failureMessage: failure?.message?.slice(0, 500) ?? null,
        },
      });
      await tx.orderEvent.create({
        data: {
          bakeryId: payment.bakeryId,
          orderId: payment.orderId,
          type: "PAYMENT_FAILED",
          actorType: "STRIPE",
          metadata: { paymentIntentId: intent.id, code: failure?.code ?? null },
        },
      });
    });
    // The slot stays held until holdExpiresAt so the customer can retry.
  }

  private async onIntentCanceled(intent: Stripe.PaymentIntent): Promise<void> {
    const payment = await this.findDepositPayment(intent);
    if (!payment) return;

    const order = await this.prisma.order.findFirst({
      where: { id: payment.orderId, bakeryId: payment.bakeryId },
      select: { slotId: true },
    });
    if (!order) return;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id: payment.orderId,
          status: { in: [OrderStatus.HELD, OrderStatus.PENDING_PAYMENT] },
        },
        data: { status: OrderStatus.EXPIRED, cancelledAt: new Date() },
      });
      if (claimed.count === 0) return;

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CANCELLED, stripePaymentIntentId: intent.id },
      });
      await tx.$executeRaw`
        UPDATE Slot SET bookedCount = GREATEST(bookedCount - 1, 0), updatedAt = UTC_TIMESTAMP(3)
        WHERE id = ${order.slotId} AND bakeryId = ${payment.bakeryId}`;
      await tx.orderEvent.create({
        data: {
          bakeryId: payment.bakeryId,
          orderId: payment.orderId,
          type: "EXPIRED",
          actorType: "STRIPE",
          metadata: { reason: "payment_intent_canceled" },
        },
      });
    });
  }

  private async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const paymentIntentId =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;

    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          ...(paymentIntentId ? [{ stripePaymentIntentId: paymentIntentId }] : []),
          { stripeChargeId: charge.id },
        ],
      },
    });
    if (!payment) return;

    const refunded = charge.amount_refunded;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        refundedCents: refunded,
        refundedAt: refunded > 0 ? new Date() : null,
        status:
          refunded >= payment.amountCents
            ? PaymentStatus.REFUNDED
            : refunded > 0
              ? PaymentStatus.PARTIALLY_REFUNDED
              : payment.status,
      },
    });
  }

  private async findDepositPayment(intent: Stripe.PaymentIntent) {
    const byIntent = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: intent.id },
      select: {
        id: true,
        orderId: true,
        bakeryId: true,
        amountCents: true,
        currency: true,
        status: true,
      },
    });
    if (byIntent) return byIntent;

    const orderId = intent.metadata.orderId;
    if (!orderId) return null;
    return this.prisma.payment.findFirst({
      where: { orderId, kind: PaymentKind.DEPOSIT },
      select: {
        id: true,
        orderId: true,
        bakeryId: true,
        amountCents: true,
        currency: true,
        status: true,
      },
    });
  }
}
