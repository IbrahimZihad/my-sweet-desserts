import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  availabilityQuerySchema,
  generateSlotsSchema,
  isoDateSchema,
  updateSlotSchema,
  type AvailabilityQuery,
  type GenerateSlotsInput,
  type UpdateSlotInput,
} from "@cakeflow/contracts";
import { Public, Roles } from "../common/decorators/auth.decorators";
import { TenantId } from "../common/decorators/request.decorators";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SlotsService } from "./slots.service";

const adminRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((value) => value.from <= value.to, { message: "`from` must be before `to`", path: ["to"] });

/**
 * Public availability. The tenant comes from the resolved bakery context
 * (x-bakery-slug or mapped host) — never from a client-supplied bakeryId.
 */
@Controller("slots")
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get()
  available(
    @TenantId() bakeryId: string,
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    return this.slots.availability(bakeryId, query);
  }
}

@Roles("OWNER")
@Controller("admin/slots")
export class AdminSlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get()
  list(
    @TenantId() bakeryId: string,
    @Query(new ZodValidationPipe(adminRangeSchema)) query: z.infer<typeof adminRangeSchema>,
  ) {
    return this.slots.listAdmin(bakeryId, query.from, query.to);
  }

  @Post("generate")
  generate(
    @TenantId() bakeryId: string,
    @Body(new ZodValidationPipe(generateSlotsSchema)) body: GenerateSlotsInput,
  ) {
    return this.slots.generate(bakeryId, body);
  }

  @Patch(":id")
  update(
    @TenantId() bakeryId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSlotSchema)) body: UpdateSlotInput,
  ) {
    return this.slots.update(bakeryId, id, body);
  }
}
