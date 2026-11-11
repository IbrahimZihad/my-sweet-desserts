import type { Bakery, PrismaClient } from "@prisma/client";
import { hashPassword } from "./password";

export const BAKERY_SLUG = "sweetcrumbs";
export const OWNER_EMAIL = "owner@sweetcrumbs.test";
export const STAFF_EMAIL = "staff@sweetcrumbs.test";

export interface SeededAccount {
  email: string;
  password: string;
}

export interface SeededUsers {
  owner: SeededAccount;
  staff: SeededAccount;
}

export async function seedBakery(prisma: PrismaClient): Promise<Bakery> {
  return prisma.bakery.upsert({
    where: { slug: BAKERY_SLUG },
    update: {
      name: "Sweet Crumbs Bakery",
      email: "hello@sweetcrumbs.test",
      phone: "+61 3 9000 0000",
      timezone: "Australia/Melbourne",
      currency: "AUD",
      brandColor: "#C084A0",
      about:
        "Small-batch celebration cakes, baked in Brunswick. Pickup only — every cake is boxed and chilled for the trip home.",
      addressLine: "12 Sydney Road",
      suburb: "Brunswick",
      postcode: "3056",
      depositType: "PERCENTAGE",
      depositValue: 2500,
      depositRefundable: true,
      refundWindowHours: 48,
      holdMinutes: 15,
      leadTimeHours: 48,
      maxAdvanceDays: 60,
      isActive: true,
    },
    create: {
      slug: BAKERY_SLUG,
      name: "Sweet Crumbs Bakery",
      email: "hello@sweetcrumbs.test",
      phone: "+61 3 9000 0000",
      timezone: "Australia/Melbourne",
      currency: "AUD",
      brandColor: "#C084A0",
      about:
        "Small-batch celebration cakes, baked in Brunswick. Pickup only — every cake is boxed and chilled for the trip home.",
      addressLine: "12 Sydney Road",
      suburb: "Brunswick",
      postcode: "3056",
      depositType: "PERCENTAGE",
      depositValue: 2500,
      depositRefundable: true,
      refundWindowHours: 48,
      holdMinutes: 15,
      leadTimeHours: 48,
      maxAdvanceDays: 60,
    },
  });
}

export async function seedUsers(prisma: PrismaClient, bakeryId: string): Promise<SeededUsers> {
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "ChangeMe123!";
  const staffPassword = process.env.SEED_STAFF_PASSWORD ?? "StaffPass123!";

  await prisma.user.upsert({
    where: { bakeryId_email: { bakeryId, email: OWNER_EMAIL } },
    update: { passwordHash: hashPassword(ownerPassword), role: "OWNER", isActive: true },
    create: {
      bakeryId,
      email: OWNER_EMAIL,
      name: "Mia Chen",
      role: "OWNER",
      passwordHash: hashPassword(ownerPassword),
    },
  });

  await prisma.user.upsert({
    where: { bakeryId_email: { bakeryId, email: STAFF_EMAIL } },
    update: { passwordHash: hashPassword(staffPassword), role: "STAFF", isActive: true },
    create: {
      bakeryId,
      email: STAFF_EMAIL,
      name: "Jordan Lee",
      role: "STAFF",
      passwordHash: hashPassword(staffPassword),
    },
  });

  return {
    owner: { email: OWNER_EMAIL, password: ownerPassword },
    staff: { email: STAFF_EMAIL, password: staffPassword },
  };
}
