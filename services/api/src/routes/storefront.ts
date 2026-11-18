import { Router } from "express";
import { z } from "zod";
import { updateBakerySchema, type UpdateBakeryInput } from "@cakeflow/contracts";
import type { Guards } from "../common/auth";
import { fromJsonText, toJsonText } from "../common/json";
import { NotFoundException } from "../common/errors";
import { validate } from "../common/validation";
import type { PrismaService } from "../prisma/prisma.service";
import { param, route, tenantId } from "./helpers";

/** `Cake.allergens` is JSON text in SQLite; the API exposes a string[]. */
function withAllergens<T extends { allergens: string | null }>(
  cake: T,
): Omit<T, "allergens"> & { allergens: string[] } {
  return { ...cake, allergens: fromJsonText<string[]>(cake.allergens, []) };
}

const cakeInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().regex(/^[a-z0-9-]{2,120}$/),
  description: z.string().trim().max(2000).nullable().optional(),
  flavour: z.string().trim().min(2).max(120),
  sizeLabel: z.string().trim().min(1).max(40),
  servings: z.number().int().min(1).max(200),
  priceCents: z.number().int().min(100).max(1_000_000),
  imageUrl: z.string().url().nullable().optional(),
  allergens: z.array(z.string().max(60)).max(20).optional(),
  leadTimeHours: z.number().int().min(0).max(720).nullable().optional(),
  isActive: z.boolean().optional(),
});

export function createStorefrontRouter(prisma: PrismaService, guards: Guards): Router {
  const router = Router();

  router.get(
    "/storefront",
    ...guards.publicTenant,
    route(async (req) => {
      const bakery = await prisma.bakery.findUnique({
        where: { id: tenantId(req) },
        select: {
          id: true,
          slug: true,
          name: true,
          legalName: true,
          email: true,
          logoUrl: true,
          brandColor: true,
          heroImageUrl: true,
          about: true,
          currency: true,
          timezone: true,
          depositType: true,
          depositValue: true,
          depositRefundable: true,
          refundWindowHours: true,
          leadTimeHours: true,
          maxAdvanceDays: true,
          isActive: true,
          addressLine: true,
          suburb: true,
          postcode: true,
          phone: true,
          cakes: {
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              flavour: true,
              sizeLabel: true,
              servings: true,
              priceCents: true,
              imageUrl: true,
              allergens: true,
            },
          },
        },
      });
      if (!bakery?.isActive) {
        throw new NotFoundException({ code: "STORE_CLOSED", message: "Storefront is unavailable." });
      }
      return { ...bakery, cakes: bakery.cakes.map(withAllergens) };
    }),
  );

  router.get(
    "/admin/bakery",
    ...guards.admin("OWNER"),
    route((req) =>
      prisma.bakery.findUniqueOrThrow({
        where: { id: tenantId(req) },
        select: {
          id: true,
          slug: true,
          name: true,
          email: true,
          phone: true,
          timezone: true,
          currency: true,
          logoUrl: true,
          heroImageUrl: true,
          brandColor: true,
          about: true,
          addressLine: true,
          suburb: true,
          postcode: true,
          depositType: true,
          depositValue: true,
          depositRefundable: true,
          refundWindowHours: true,
          holdMinutes: true,
          leadTimeHours: true,
          maxAdvanceDays: true,
          piiRetentionDays: true,
          stripeAccountId: true,
          stripeChargesEnabled: true,
        },
      }),
    ),
  );

  router.patch(
    "/admin/bakery",
    ...guards.admin("OWNER"),
    validate(updateBakerySchema),
    route((req) =>
      prisma.bakery.update({
        where: { id: tenantId(req) },
        data: req.body as UpdateBakeryInput,
      }),
    ),
  );

  router.get(
    "/admin/bakery/cakes",
    ...guards.admin("OWNER"),
    route(async (req) => {
      const cakes = await prisma.cake.findMany({
        where: { bakeryId: tenantId(req) },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      return cakes.map(withAllergens);
    }),
  );

  router.post(
    "/admin/bakery/cakes",
    ...guards.admin("OWNER"),
    validate(cakeInputSchema),
    route(async (req) => {
      const { allergens, ...rest } = req.body as z.infer<typeof cakeInputSchema>;
      const cake = await prisma.cake.create({
        data: { ...rest, bakeryId: tenantId(req), allergens: toJsonText(allergens ?? []) },
      });
      return withAllergens(cake);
    }, 201),
  );

  router.patch(
    "/admin/bakery/cakes/:id",
    ...guards.admin("OWNER"),
    validate(cakeInputSchema.partial()),
    route(async (req) => {
      const bakeryId = tenantId(req);
      const { allergens, ...rest } = req.body as Partial<z.infer<typeof cakeInputSchema>>;
      const cake = await prisma.cake.findFirst({
        where: { id: param(req, "id"), bakeryId },
        select: { id: true },
      });
      if (!cake) throw new NotFoundException({ code: "CAKE_NOT_FOUND", message: "Cake not found." });

      const updated = await prisma.cake.update({
        where: { id: cake.id },
        data: { ...rest, ...(allergens === undefined ? {} : { allergens: toJsonText(allergens) }) },
      });
      return withAllergens(updated);
    }),
  );

  router.get(
    "/admin/stats",
    ...guards.admin("OWNER", "STAFF"),
    route(async (req) => {
      const bakeryId = tenantId(req);
      const now = new Date();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      const [todaysBookings, pendingDeposits, confirmedRevenue, upcoming] = await prisma.$transaction([
        prisma.order.count({
          where: {
            bakeryId,
            slot: { startsAt: { gte: dayStart, lt: dayEnd } },
            status: { in: ["CONFIRMED", "HELD"] },
          },
        }),
        prisma.payment.count({
          where: { bakeryId, status: { in: ["REQUIRES_PAYMENT", "PROCESSING"] }, kind: "DEPOSIT" },
        }),
        prisma.payment.aggregate({
          where: { bakeryId, status: "SUCCEEDED", kind: "DEPOSIT" },
          _sum: { amountCents: true },
        }),
        prisma.order.count({
          where: { bakeryId, status: "CONFIRMED", slot: { startsAt: { gte: now } } },
        }),
      ]);

      return {
        todaysBookings,
        pendingDeposits,
        depositRevenueCents: confirmedRevenue._sum.amountCents ?? 0,
        upcomingBookings: upcoming,
      };
    }),
  );

  return router;
}
