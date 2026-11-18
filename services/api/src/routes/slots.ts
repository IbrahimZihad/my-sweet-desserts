import { Router } from "express";
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
import type { Guards } from "../common/auth";
import { rateLimit } from "../common/rate-limit";
import { validate } from "../common/validation";
import type { Services } from "../services";
import { param, route, tenantId } from "./helpers";

const adminRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((value) => value.from <= value.to, { message: "`from` must be before `to`", path: ["to"] });

export function createSlotsRouter(services: Services, guards: Guards): Router {
  const router = Router();

  /**
   * Public availability. The tenant comes from the resolved bakery context
   * (x-bakery-slug or mapped host) — never from a client-supplied bakeryId.
   */
  router.get(
    "/slots",
    rateLimit({ name: "slots", windowMs: 60_000, max: 120 }),
    ...guards.publicTenant,
    validate(availabilityQuerySchema, "query"),
    route((req) => services.slots.availability(tenantId(req), req.query as unknown as AvailabilityQuery)),
  );

  router.get(
    "/admin/slots",
    ...guards.admin("OWNER"),
    validate(adminRangeSchema, "query"),
    route((req) => {
      const query = req.query as unknown as { from: string; to: string };
      return services.slots.listAdmin(tenantId(req), query.from, query.to);
    }),
  );

  router.post(
    "/admin/slots/generate",
    ...guards.admin("OWNER"),
    validate(generateSlotsSchema),
    route((req) => services.slots.generate(tenantId(req), req.body as GenerateSlotsInput), 201),
  );

  router.patch(
    "/admin/slots/:id",
    ...guards.admin("OWNER"),
    validate(updateSlotSchema),
    route((req) => services.slots.update(tenantId(req), param(req, "id"), req.body as UpdateSlotInput)),
  );

  return router;
}
