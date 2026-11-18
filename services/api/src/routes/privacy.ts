import { Router } from "express";
import { z } from "zod";
import {
  privacyErasureSchema,
  privacyRequestSchema,
  type PrivacyErasureInput,
  type PrivacyRequestInput,
} from "@cakeflow/contracts";
import type { Guards } from "../common/auth";
import { bodyString, rateLimit } from "../common/rate-limit";
import { validate } from "../common/validation";
import type { Services } from "../services";
import { route, tenantId } from "./helpers";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Public data-subject request endpoints. The customer proves control of the
 * booking with the same `reference + email` pair used by the booking lookup.
 */
export function createPrivacyRouter(services: Services, guards: Guards): Router {
  const router = Router();
  const limit = (name: string) =>
    rateLimit({
      name,
      windowMs: 60_000,
      max: 5,
      key: (req) => `${req.ip}:${bodyString(req, "email")}`,
    });

  router.post(
    "/privacy/export",
    limit("privacy-export"),
    ...guards.publicTenant,
    validate(privacyRequestSchema),
    route((req) => services.privacy.exportData(tenantId(req), req.body as PrivacyRequestInput), 201),
  );

  router.post(
    "/privacy/erase",
    limit("privacy-erase"),
    ...guards.publicTenant,
    validate(privacyErasureSchema),
    route((req) => services.privacy.eraseData(tenantId(req), req.body as PrivacyErasureInput), 201),
  );

  router.get(
    "/admin/privacy/requests",
    ...guards.admin("OWNER"),
    validate(listSchema, "query"),
    route((req) => {
      const query = req.query as unknown as z.infer<typeof listSchema>;
      return services.privacy.listRequests(tenantId(req), query.page, query.pageSize);
    }),
  );

  router.post(
    "/admin/privacy/retention/run",
    ...guards.admin("OWNER"),
    route((req) => services.privacy.runRetention(tenantId(req)), 201),
  );

  return router;
}
