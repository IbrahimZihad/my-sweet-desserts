import type { Bakery, PrismaClient } from "@prisma/client";

const DEMO_REFERENCE = "CF-DEMO01";
const DEMO_EMAIL = "demo@sweetcrumbs.test";
const DEMO_IDEMPOTENCY_KEY = "seed-demo-booking-v1";

export interface SeededBooking {
  reference: string;
  created: boolean;
}

/**
 * Creates one CONFIRMED pickup so the admin dashboard is not empty on a fresh
 * install. It is idempotent: the order reference is checked first, so capacity
 * is never double-consumed.
 */
export async function seedDemoBooking(
  prisma: PrismaClient,
  bakery: Bakery,
): Promise<SeededBooking | null> {
  if (process.env.SEED_DEMO_BOOKING === "0") return null;

  const existing = await prisma.order.findUnique({
    where: { reference: DEMO_REFERENCE },
    select: { reference: true },
  });
  if (existing) return { reference: existing.reference, created: false };

  const cake = await prisma.cake.findFirst({
    where: { bakeryId: bakery.id, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, priceCents: true },
  });
  if (!cake) return null;

  // Pick a window beyond the bakery lead time that still has room.
  const candidates = await prisma.slot.findMany({
    where: {
      bakeryId: bakery.id,
      status: "OPEN",
      startsAt: { gte: new Date(Date.now() + bakery.leadTimeHours * 3_600_000) },
    },
    orderBy: { startsAt: "asc" },
    take: 10,
  });
  const slot = candidates.find((candidate) => candidate.bookedCount < candidate.capacity);
  if (!slot) return null;

  const customer = await prisma.user.upsert({
    where: { bakeryId_email: { bakeryId: bakery.id, email: DEMO_EMAIL } },
    update: { name: "Demo Customer", phone: "+61 400 000 000" },
    create: {
      bakeryId: bakery.id,
      email: DEMO_EMAIL,
      name: "Demo Customer",
      phone: "+61 400 000 000",
      role: "CUSTOMER",
    },
  });

  const totalCents = slot.priceOverrideCents ?? cake.priceCents;
  const depositCents =
    bakery.depositType === "FLAT"
      ? Math.min(bakery.depositValue, totalCents)
      : Math.min(Math.max(Math.round((totalCents * bakery.depositValue) / 10_000), 100), totalCents);
  const now = new Date();

  const created = await prisma.$transaction(async (tx) => {
    const reserved = await tx.$executeRaw`
      UPDATE Slot
         SET bookedCount = bookedCount + 1, updatedAt = UTC_TIMESTAMP(3)
       WHERE id = ${slot.id}
         AND bakeryId = ${bakery.id}
         AND status = 'OPEN'
         AND bookedCount < capacity`;
    if (reserved !== 1) return null;

    const order = await tx.order.create({
      data: {
        reference: DEMO_REFERENCE,
        bakeryId: bakery.id,
        customerId: customer.id,
        cakeId: cake.id,
        slotId: slot.id,
        status: "CONFIRMED",
        customerName: "Demo Customer",
        customerEmail: DEMO_EMAIL,
        customerPhone: "+61 400 000 000",
        notes: "Seeded demo booking — safe to cancel or delete.",
        totalCents,
        depositCents,
        balanceDueCents: totalCents - depositCents,
        currency: bakery.currency,
        depositRefundable: bakery.depositRefundable,
        refundWindowHours: bakery.refundWindowHours,
        holdExpiresAt: now,
        confirmedAt: now,
        idempotencyKey: DEMO_IDEMPOTENCY_KEY,
      },
    });

    await tx.payment.create({
      data: {
        bakeryId: bakery.id,
        orderId: order.id,
        kind: "DEPOSIT",
        status: "SUCCEEDED",
        amountCents: depositCents,
        currency: bakery.currency,
        refundable: bakery.depositRefundable,
      },
    });

    await tx.orderEvent.create({
      data: {
        bakeryId: bakery.id,
        orderId: order.id,
        type: "CONFIRMED",
        actorType: "SYSTEM",
        metadata: { seeded: true, cakeName: cake.name },
      },
    });

    return order;
  });

  return created ? { reference: created.reference, created: true } : null;
}
