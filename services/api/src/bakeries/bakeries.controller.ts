import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { updateBakerySchema, type UpdateBakeryInput } from "@cakeflow/contracts";
import { Public, Roles } from "../common/decorators/auth.decorators";
import { TenantId } from "../common/decorators/request.decorators";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PrismaService } from "../prisma/prisma.service";

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

@Controller("storefront")
export class StorefrontController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async get(@TenantId() bakeryId: string) {
    const bakery = await this.prisma.bakery.findUnique({
      where: { id: bakeryId },
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
    return bakery;
  }
}

@Roles("OWNER")
@Controller("admin/bakery")
export class AdminBakeryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  get(@TenantId() bakeryId: string) {
    return this.prisma.bakery.findUniqueOrThrow({
      where: { id: bakeryId },
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
    });
  }

  @Patch()
  update(
    @TenantId() bakeryId: string,
    @Body(new ZodValidationPipe(updateBakerySchema)) body: UpdateBakeryInput,
  ) {
    return this.prisma.bakery.update({ where: { id: bakeryId }, data: body });
  }

  @Get("cakes")
  listCakes(@TenantId() bakeryId: string) {
    return this.prisma.cake.findMany({
      where: { bakeryId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  @Post("cakes")
  createCake(
    @TenantId() bakeryId: string,
    @Body(new ZodValidationPipe(cakeInputSchema)) body: z.infer<typeof cakeInputSchema>,
  ) {
    return this.prisma.cake.create({
      data: {
        ...body,
        bakeryId,
        allergens: body.allergens ?? [],
      },
    });
  }

  @Patch("cakes/:id")
  async updateCake(
    @TenantId() bakeryId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cakeInputSchema.partial())) body: Partial<z.infer<typeof cakeInputSchema>>,
  ) {
    const cake = await this.prisma.cake.findFirst({ where: { id, bakeryId }, select: { id: true } });
    if (!cake) throw new NotFoundException({ code: "CAKE_NOT_FOUND", message: "Cake not found." });
    return this.prisma.cake.update({ where: { id: cake.id }, data: body });
  }
}

@Roles("OWNER", "STAFF")
@Controller("admin/stats")
export class AdminStatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async stats(@TenantId() bakeryId: string) {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [todaysBookings, pendingDeposits, confirmedRevenue, upcoming] = await this.prisma.$transaction([
      this.prisma.order.count({
        where: { bakeryId, slot: { startsAt: { gte: dayStart, lt: dayEnd } }, status: { in: ["CONFIRMED", "HELD"] } },
      }),
      this.prisma.payment.count({
        where: { bakeryId, status: { in: ["REQUIRES_PAYMENT", "PROCESSING"] }, kind: "DEPOSIT" },
      }),
      this.prisma.payment.aggregate({
        where: { bakeryId, status: "SUCCEEDED", kind: "DEPOSIT" },
        _sum: { amountCents: true },
      }),
      this.prisma.order.count({
        where: { bakeryId, status: "CONFIRMED", slot: { startsAt: { gte: now } } },
      }),
    ]);

    return {
      todaysBookings,
      pendingDeposits,
      depositRevenueCents: confirmedRevenue._sum.amountCents ?? 0,
      upcomingBookings: upcoming,
    };
  }
}
