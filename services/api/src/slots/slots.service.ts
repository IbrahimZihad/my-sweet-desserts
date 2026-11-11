import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { SlotStatus } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  GenerateSlotsInput,
  UpdateSlotInput,
} from "@cakeflow/contracts";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SlotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Customer-facing availability. Returns only OPEN slots with remaining
   * capacity, already filtered by the cake's lead time.
   */
  async availability(bakeryId: string, query: AvailabilityQuery): Promise<AvailabilityResponse> {
    const bakery = await this.prisma.bakery.findUniqueOrThrow({
      where: { id: bakeryId },
      select: {
        id: true,
        slug: true,
        name: true,
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
      },
    });

    if (!bakery.isActive) throw new NotFoundException({ code: "STORE_CLOSED", message: "Storefront is unavailable." });

    const cake = query.cakeId
      ? await this.prisma.cake.findFirst({
          where: { id: query.cakeId, bakeryId, isActive: true },
          select: { id: true, priceCents: true, leadTimeHours: true },
        })
      : null;
    if (query.cakeId && !cake) {
      throw new NotFoundException({ code: "CAKE_NOT_FOUND", message: "That cake is no longer available." });
    }

    const now = new Date();
    const leadHours = cake?.leadTimeHours ?? bakery.leadTimeHours;
    const earliest = new Date(Math.max(now.getTime(), now.getTime() + leadHours * 3_600_000));
    const latest = new Date(now.getTime() + bakery.maxAdvanceDays * 86_400_000);

    const from = fromZonedTime(`${query.from}T00:00:00`, bakery.timezone);
    const to = fromZonedTime(`${query.to}T23:59:59.999`, bakery.timezone);

    const slots = await this.prisma.slot.findMany({
      where: {
        bakeryId,
        status: SlotStatus.OPEN,
        startsAt: { gte: new Date(Math.max(from.getTime(), earliest.getTime())), lte: new Date(Math.min(to.getTime(), latest.getTime())) },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        bookedCount: true,
        priceOverrideCents: true,
      },
    });

    return {
      bakery: {
        id: bakery.id,
        slug: bakery.slug,
        name: bakery.name,
        logoUrl: bakery.logoUrl,
        brandColor: bakery.brandColor,
        heroImageUrl: bakery.heroImageUrl,
        about: bakery.about,
        currency: bakery.currency,
        timezone: bakery.timezone,
        depositPolicy: {
          type: bakery.depositType,
          value: bakery.depositValue,
          refundable: bakery.depositRefundable,
          refundWindowHours: bakery.refundWindowHours,
        },
      },
      slots: slots.map((slot) => {
        const remaining = Math.max(0, slot.capacity - slot.bookedCount);
        return {
          id: slot.id,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          capacity: slot.capacity,
          booked: slot.bookedCount,
          remaining,
          priceCents: slot.priceOverrideCents ?? cake?.priceCents ?? null,
          isAvailable: remaining > 0,
        };
      }),
    };
  }

  async listAdmin(bakeryId: string, from: string, to: string) {
    const bakery = await this.prisma.bakery.findUniqueOrThrow({
      where: { id: bakeryId },
      select: { timezone: true },
    });
    return this.prisma.slot.findMany({
      where: {
        bakeryId,
        startsAt: {
          gte: fromZonedTime(`${from}T00:00:00`, bakery.timezone),
          lte: fromZonedTime(`${to}T23:59:59.999`, bakery.timezone),
        },
      },
      orderBy: { startsAt: "asc" },
      include: { _count: { select: { orders: { where: { status: { in: ["HELD", "CONFIRMED"] } } } } } },
    });
  }

  async generate(bakeryId: string, input: GenerateSlotsInput): Promise<{ created: number; skipped: number }> {
    const bakery = await this.prisma.bakery.findUniqueOrThrow({
      where: { id: bakeryId },
      select: { timezone: true },
    });

    const dates = enumerateDates(input.from, input.to, input.weekdays);
    const [startHour, startMinute] = input.startTime.split(":").map(Number) as [number, number];
    const [endHour, endMinute] = input.endTime.split(":").map(Number) as [number, number];
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    const rows: Array<{
      bakeryId: string;
      startsAt: Date;
      endsAt: Date;
      serviceDate: Date;
      capacity: number;
    }> = [];

    for (const date of dates) {
      for (let m = startMinutes; m + input.durationMinutes <= endMinutes; m += input.durationMinutes) {
        const hh = String(Math.floor(m / 60)).padStart(2, "0");
        const mm = String(m % 60).padStart(2, "0");
        const endTotal = m + input.durationMinutes;
        const endHH = String(Math.floor(endTotal / 60)).padStart(2, "0");
        const endMM = String(endTotal % 60).padStart(2, "0");
        rows.push({
          bakeryId,
          startsAt: fromZonedTime(`${date}T${hh}:${mm}:00`, bakery.timezone),
          endsAt: fromZonedTime(`${date}T${endHH}:${endMM}:00`, bakery.timezone),
          serviceDate: new Date(`${date}T00:00:00.000Z`),
          capacity: input.capacity,
        });
      }
    }

    const result = await this.prisma.slot.createMany({ data: rows, skipDuplicates: true });
    return { created: result.count, skipped: rows.length - result.count };
  }

  async update(bakeryId: string, slotId: string, input: UpdateSlotInput) {
    const slot = await this.prisma.slot.findFirst({ where: { id: slotId, bakeryId } });
    if (!slot) throw new NotFoundException({ code: "SLOT_NOT_FOUND", message: "Slot not found." });

    if (input.capacity !== undefined && input.capacity < slot.bookedCount) {
      throw new ConflictException({
        code: "CAPACITY_BELOW_BOOKINGS",
        message: `Capacity cannot be below the ${slot.bookedCount} existing bookings.`,
      });
    }

    return this.prisma.slot.update({
      where: { id: slot.id },
      data: {
        capacity: input.capacity,
        status: input.status,
        priceOverrideCents: input.priceOverrideCents,
      },
    });
  }

  async close(bakeryId: string, slotId: string) {
    return this.update(bakeryId, slotId, { status: SlotStatus.CLOSED });
  }
}

function enumerateDates(from: string, to: string, weekdays: number[]): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    if (weekdays.includes(cursor.getUTCDay())) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
