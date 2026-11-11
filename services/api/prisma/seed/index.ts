import type { PrismaClient } from "@prisma/client";
import { seedBakery, seedUsers } from "./bakery";
import { seedCakes } from "./catalog";
import { seedSlots } from "./slots";
import { seedDemoBooking } from "./bookings";

/**
 * Idempotent development seed. Safe to run repeatedly:
 * - bakery, staff and cakes are upserted;
 * - existing pickup windows are left untouched;
 * - the demo booking is only created once (reference check + capacity guard).
 */
export async function runSeed(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=1 to override.",
    );
  }

  const bakery = await seedBakery(prisma);
  const users = await seedUsers(prisma, bakery.id);
  const cakeCount = await seedCakes(prisma, bakery.id);
  const slotCount = await seedSlots(prisma, bakery);
  const booking = await seedDemoBooking(prisma, bakery);

  console.log(`\nSeeded bakery "${bakery.name}" (${bakery.slug})`);
  console.log(`  Cakes:          ${cakeCount}`);
  console.log(`  Pickup windows: ${slotCount}`);
  console.log(`  Owner login:    ${users.owner.email} / ${users.owner.password}`);
  console.log(`  Staff login:    ${users.staff.email} / ${users.staff.password}`);
  if (booking) {
    console.log(
      `  Demo booking:   ${booking.reference} ${booking.created ? "(created)" : "(already present)"}`,
    );
  }
  console.log("");
}
