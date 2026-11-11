import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  createBookingSchema,
  emailSchema,
  isoDateSchema,
  type CreateBookingInput,
} from "@cakeflow/contracts";
import { OrderStatus } from "@prisma/client";
import { Public, Roles } from "../common/decorators/auth.decorators";
import { CurrentUser, TenantId, type AuthenticatedUser } from "../common/decorators/request.decorators";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { BookingsService } from "./bookings.service";

const lookupSchema = z.object({ email: emailSchema });
const cancelSchema = z.object({
  email: emailSchema,
  reason: z.string().trim().max(500).optional(),
});
const adminListSchema = z.object({
  status: z
    .enum([
      OrderStatus.HELD,
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.CONFIRMED,
      OrderStatus.CANCELLED,
      OrderStatus.EXPIRED,
      OrderStatus.COMPLETED,
    ])
    .optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const adminCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  refund: z.boolean().optional(),
});

@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(
    @TenantId() bakeryId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput,
  ) {
    return this.bookings.create(bakeryId, idempotencyKey, body);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(":reference")
  get(
    @TenantId() bakeryId: string,
    @Param("reference") reference: string,
    @Query(new ZodValidationPipe(lookupSchema)) query: { email: string },
  ) {
    return this.bookings.getByReference(bakeryId, reference, query.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(":reference/cancel")
  cancel(
    @TenantId() bakeryId: string,
    @Param("reference") reference: string,
    @Body(new ZodValidationPipe(cancelSchema)) body: { email: string },
  ) {
    return this.bookings.cancelByCustomer(bakeryId, reference, body.email);
  }
}

@Roles("OWNER", "STAFF")
@Controller("admin/bookings")
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(
    @TenantId() bakeryId: string,
    @Query(new ZodValidationPipe(adminListSchema))
    query: z.infer<typeof adminListSchema>,
  ) {
    return this.bookings.listAdmin(bakeryId, query);
  }

  @Post(":id/cancel")
  cancel(
    @TenantId() bakeryId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(adminCancelSchema))
    body: z.infer<typeof adminCancelSchema>,
  ) {
    return this.bookings.cancelByAdmin(bakeryId, id, user.id, body);
  }
}
