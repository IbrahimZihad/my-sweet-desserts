import { PrismaClient } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function main(): Promise<void> {
  const timezone = "Australia/Melbourne";

  const bakery = await prisma.bakery.upsert({
    where: { slug: "sweetcrumbs" },
    update: {},
    create: {
      slug: "sweetcrumbs",
      name: "Sweet Crumbs Bakery",
      email: "hello@sweetcrumbs.test",
      phone: "+61 3 9000 0000",
      timezone,
      currency: "AUD",
      brandColor: "#C084A0",
      about:
        "Small-batch celebration cakes, baked in Brunswick. Pickup only — every cake is boxed and chilled for the trip home.",
      addressLine: "12 Sydney Road",
      suburb: "Brunswick",
      postcode: "3056",
      depositType: "PERCENTAGE",
      depositValue: 2500, // 25%
      depositRefundable: true,
      refundWindowHours: 48,
      holdMinutes: 15,
      leadTimeHours: 48,
      maxAdvanceDays: 60,
    },
  });

  const ownerEmail = "owner@sweetcrumbs.test";
  const password = process.env.SEED_OWNER_PASSWORD ?? "ChangeMe123!";
  await prisma.user.upsert({
    where: { bakeryId_email: { bakeryId: bakery.id, email: ownerEmail } },
    update: { passwordHash: hashPassword(password), role: "OWNER", isActive: true },
    create: {
      bakeryId: bakery.id,
      email: ownerEmail,
      name: "Mia Chen",
      role: "OWNER",
      passwordHash: hashPassword(password),
    },
  });

  const cakes = [
    {
      slug: "vanilla-bean-30cm",
      name: "Vanilla Bean Celebration",
      flavour: "Madagascan vanilla",
      sizeLabel: "30cm",
      servings: 24,
      priceCents: 18_000,
      description: "Layers of vanilla sponge, vanilla bean buttercream and a white chocolate drip.",
    },
    {
      slug: "dark-chocolate-25cm",
      name: "Dark Chocolate Ganache",
      flavour: "70% dark chocolate",
      sizeLabel: "25cm",
      servings: 16,
      priceCents: 15_500,
      description: "Rich cocoa sponge with whipped dark chocolate ganache.",
    },
    {
      slug: "lemon-curd-20cm",
      name: "Lemon Curd Layer",
      flavour: "Lemon & elderflower",
      sizeLabel: "20cm",
      servings: 10,
      priceCents: 12_000,
      description: "Bright lemon curd, elderflower cream and a light citrus glaze.",
    },
  ];

  for (const [index, cake] of cakes.entries()) {
    await prisma.cake.upsert({
      where: { bakeryId_slug: { bakeryId: bakery.id, slug: cake.slug } },
      update: {},
      create: {
        ...cake,
        bakeryId: bakery.id,
        sortOrder: index,
        allergens: ["gluten", "dairy", "egg"],
      },
    });
  }

  // Two pickup windows per day for the next 21 days (skip Mondays).
  const today = new Date();
  for (let day = 0; day < 21; day += 1) {
    const cursor = new Date(today.getTime() + day * 86_400_000);
    const date = cursor.toISOString().slice(0, 10);
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (weekday === 1) continue;

    for (const time of ["11:00", "16:00"]) {
      const startsAt = fromZonedTime(`${date}T${time}:00`, timezone);
      const endsAt = new Date(startsAt.getTime() + 45 * 60_000);
      await prisma.slot.upsert({
        where: { bakeryId_startsAt: { bakeryId: bakery.id, startsAt } },
        update: {},
        create: {
          bakeryId: bakery.id,
          startsAt,
          endsAt,
          serviceDate: new Date(`${date}T00:00:00.000Z`),
          capacity: 2,
        },
      });
    }
  }

  console.log(`Seeded bakery "${bakery.name}" (${bakery.slug})`);
  console.log(`Admin login: ${ownerEmail} / ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
