import { Router } from "express";
import { z } from "zod";
import {
  createBookingSchema,
  emailSchema,
  isoDateSchema,
  OrderStatus,
  type CreateBookingInput,
} from "@cakeflow/contracts";
import type { Guards } from "../common/auth";
import { rateLimit } from "../common/rate-limit";
import { validate } from "../common/validation";
import type { Services } from "../services";
import { currentUser, param, route, tenantId } from "./helpers";

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
const announcementsSchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
});

export function createBookingsRouter(services: Services, guards: Guards): Router {
  const router = Router();

  router.post(
    "/bookings",
    rateLimit({ name: "booking-create", windowMs: 60_000, max: 10 }),
    ...guards.publicTenant,
    validate(createBookingSchema),
    route(
      (req) =>
        services.bookings.create(
          tenantId(req),
          req.header("idempotency-key"),
          req.body as CreateBookingInput,
        ),
      201,
    ),
  );

  router.get(
    "/bookings/:reference",
    rateLimit({ name: "booking-lookup", windowMs: 60_000, max: 30 }),
    ...guards.publicTenant,
    validate(lookupSchema, "query"),
    route((req) => {
      const query = req.query as unknown as { email: string };
      return services.bookings.getByReference(tenantId(req), param(req, "reference"), query.email);
    }),
  );

  router.post(
    "/bookings/:reference/cancel",
    rateLimit({ name: "booking-cancel", windowMs: 60_000, max: 10 }),
    ...guards.publicTenant,
    validate(cancelSchema),
    route((req) => {
      const body = req.body as { email: string };
      return services.bookings.cancelByCustomer(tenantId(req), param(req, "reference"), body.email);
    }, 201),
  );

  router.get(
    "/admin/bookings",
    ...guards.admin("OWNER", "STAFF"),
    validate(adminListSchema, "query"),
    route((req) =>
      services.bookings.listAdmin(
        tenantId(req),
        req.query as unknown as z.infer<typeof adminListSchema>,
      ),
    ),
  );

  /**
   * Polled by the dashboard to announce new bookings aloud. `since` is a
   * cursor from the previous response's `serverTime`.
   */
  router.get(
    "/admin/bookings/announcements",
    ...guards.admin("OWNER", "STAFF"),
    validate(announcementsSchema, "query"),
    route((req) => {
      const query = req.query as unknown as z.infer<typeof announcementsSchema>;
      const since = query.since ? new Date(query.since) : new Date(Date.now() - 30_000);
      return services.bookings.listAnnouncements(tenantId(req), since);
    }),
  );

  router.post(
    "/admin/bookings/:id/cancel",
    ...guards.admin("OWNER", "STAFF"),
    validate(adminCancelSchema),
    route((req) => {
      const body = req.body as z.infer<typeof adminCancelSchema>;
      return services.bookings.cancelByAdmin(tenantId(req), param(req, "id"), currentUser(req).id, body);
    }, 201),
  );

  return router;
}
