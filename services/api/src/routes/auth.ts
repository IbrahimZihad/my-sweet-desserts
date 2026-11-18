import { loginSchema, refreshSchema, type LoginInput } from "@cakeflow/contracts";
import { Router } from "express";
import type { Guards } from "../common/auth";
import { bodyString, rateLimit } from "../common/rate-limit";
import { validate } from "../common/validation";
import type { Services } from "../services";
import { currentUser, route, tenantId } from "./helpers";

export function createAuthRouter(services: Services, guards: Guards): Router {
  const router = Router();

  router.post(
    "/auth/login",
    rateLimit({
      name: "auth-login",
      windowMs: 60_000,
      max: 5,
      key: (req) => `${req.ip}:${bodyString(req, "email")}`,
    }),
    ...guards.publicTenant,
    validate(loginSchema),
    route(
      (req) =>
        services.auth.login(tenantId(req), req.body as LoginInput, {
          userAgent: req.header("user-agent"),
          ipAddress: req.ip,
        }),
      201,
    ),
  );

  router.post(
    "/auth/refresh",
    rateLimit({ name: "auth-refresh", windowMs: 60_000, max: 20 }),
    ...guards.publicNoTenant,
    validate(refreshSchema),
    route((req) => services.auth.refresh((req.body as { refreshToken: string }).refreshToken), 201),
  );

  router.post(
    "/auth/logout",
    ...guards.publicNoTenant,
    route(async (req) => {
      const body = req.body as { refreshToken?: unknown } | undefined;
      const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken : undefined;
      await services.auth.logout(refreshToken);
      return { ok: true };
    }, 201),
  );

  router.get(
    "/auth/me",
    ...guards.admin("OWNER", "STAFF"),
    route((req) => {
      const user = currentUser(req);
      return {
        id: user.id,
        bakeryId: user.bakeryId,
        email: user.email,
        name: user.name,
        role: user.role,
      };
    }),
  );

  return router;
}
