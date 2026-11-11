import type { Bakery, PrismaClient } from "@prisma/client";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const SEED_DAYS = 21;
const PICKUP_TIMES = ["11:00", "16:00"] as const;
const SLOT_CAPACITY = 2;
const SLOT_MINUTES = 45;

/**
 * Creates two pickup windows per day for the next three weeks.
 * Mondays are closed, matching the demo bakery's real schedule.
 *
 * Existing slots are left untouched (`update: {}`) so re-seeding never resets
 * capacity that a booking has already consumed.
 */
export async function seedSlots(prisma: PrismaClient, bakery: Bakery): Promise<number> {
  const today = formatInTimeZone(new Date(), bakery.timezone, "yyyy-MM-dd");
  // Anchor at noon UTC so adding days never crosses a DST boundary.
  const anchor = new Date(`${today}T12:00:00.000Z`);
  let ensured = 0;

  for (let day = 0; day < SEED_DAYS; day += 1) {
    const date = addDays(anchor, day).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (weekday === 1) continue;

    for (const time of PICKUP_TIMES) {
      const startsAt = fromZonedTime(`${date}T${time}:00`, bakery.timezone);
      const endsAt = new Date(startsAt.getTime() + SLOT_MINUTES * 60_000);

      await prisma.slot.upsert({
        where: { bakeryId_startsAt: { bakeryId: bakery.id, startsAt } },
        update: {},
        create: {
          bakeryId: bakery.id,
          startsAt,
          endsAt,
          serviceDate: new Date(`${date}T00:00:00.000Z`),
          capacity: SLOT_CAPACITY,
        },
      });
      ensured += 1;
    }
  }

  return ensured;
}
