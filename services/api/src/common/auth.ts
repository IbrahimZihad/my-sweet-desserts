import type { Bakery } from "@prisma/client";
import type { UserRole } from "@cakeflow/contracts";
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/env";
import type { PrismaService } from "../prisma/prisma.service";
import type { TenantContextService } from "./tenant/tenant-context.service";
import { BadRequestException, ForbiddenException, UnauthorizedException } from "./errors";

export type StaffRole = Extract<UserRole, "OWNER" | "STAFF">;

export type BakeryContext = Pick<
  Bakery,
  "id" | "slug" | "name" | "timezone" | "currency" | "customDomain"
>;

export interface AuthenticatedUser {
  id: string;
  bakeryId: string;
  email: string;
  name: string;
  role: StaffRole;
  sessionId: string;
}

export interface ApiRequest extends Request {
  requestId: string;
  bakery?: BakeryContext;
  user?: AuthenticatedUser;
  rawBody?: Buffer;
}

interface AccessTokenPayload {
  sub: string;
  bakeryId: string;
  role: StaffRole;
  sid: string;
}

interface CacheEntry {
  bakery: BakeryContext | undefined;
  expiresAt: number;
}

/**
 * Resolves the tenant from (in order):
 *   1. `x-bakery-slug` — set by the Next.js BFF, never trusted for authorisation
 *   2. exact custom domain match
 *   3. subdomain label (`sweetcrumbs.cakeflow.app`)
 *
 * The resolved bakery is only a routing hint. The JWT middleware additionally
 * verifies that an admin's `bakeryId` matches this tenant.
 */
export function requestContext(prisma: PrismaService): RequestHandler {
  const cache = new Map<string, CacheEntry>();
  const ttlMs = 30_000;

  const bySlug = async (slug: string | null): Promise<BakeryContext | undefined> => {
    if (!slug) return undefined;
    const cached = cache.get(`slug:${slug}`);
    if (cached && cached.expiresAt > Date.now()) return cached.bakery;

    const bakery = await prisma.bakery.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, timezone: true, currency: true, customDomain: true },
    });
    if (bakery) cache.set(`slug:${slug}`, { bakery, expiresAt: Date.now() + ttlMs });
    return bakery ?? undefined;
  };

  const byCustomDomain = async (host: string): Promise<BakeryContext | undefined> => {
    if (!host.includes(".")) return undefined;
    const cached = cache.get(`host:${host}`);
    if (cached && cached.expiresAt > Date.now()) return cached.bakery;

    const bakery = await prisma.bakery.findUnique({
      where: { customDomain: host },
      select: { id: true, slug: true, name: true, timezone: true, currency: true, customDomain: true },
    });
    if (bakery) cache.set(`host:${host}`, { bakery, expiresAt: Date.now() + ttlMs });
    return bakery ?? undefined;
  };

  return async (req, res, next) => {
    const apiReq = req as ApiRequest;
    apiReq.requestId = apiReq.requestId ?? req.header("x-request-id") ?? randomUUID();
    res.setHeader("x-request-id", apiReq.requestId);

    const slugHeader = req.header("x-bakery-slug")?.toLowerCase().trim();
    const host = (req.header("x-forwarded-host") ?? req.header("host") ?? "")
      .split(",")[0]!
      .split(":")[0]!
      .toLowerCase();

    try {
      if (slugHeader) {
        apiReq.bakery = await bySlug(slugHeader);
      } else if (host.endsWith(".localhost") || host === "localhost" || isIpAddress(host)) {
        apiReq.bakery = await bySlug(subdomain(host));
      } else if (host) {
        apiReq.bakery = (await byCustomDomain(host)) ?? (await bySlug(subdomain(host)));
      }
    } catch {
      // Tenant resolution must never take down the request; the tenant guard
      // returns a typed TENANT_REQUIRED error instead.
    }

    next();
  };
}

/**
 * Defence in depth: the API is only meant to be reached through the Next.js
 * BFF. Stripe and health checks are the only routes that skip this.
 */
export function internalKey(config: AppConfig): RequestHandler {
  const expected = config.INTERNAL_API_KEY;
  return (req, _res, next) => {
    const provided = req.header("x-internal-key");
    if (!provided || !safeEqual(provided, expected)) {
      next(
        new UnauthorizedException({
          code: "BFF_KEY_REQUIRED",
          message: "This API is only available through the CakeFlow frontend.",
        }),
      );
      return;
    }
    next();
  };
}

export function authenticate(config: AppConfig, prisma: PrismaService): RequestHandler {
  return async (req, _res, next) => {
    try {
      const apiReq = req as ApiRequest;
      const token = extractToken(apiReq);
      if (!token) {
        throw new UnauthorizedException({ code: "AUTH_REQUIRED", message: "Sign in required." });
      }

      let payload: AccessTokenPayload;
      try {
        payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
      } catch {
        throw new UnauthorizedException({ code: "TOKEN_INVALID", message: "Session expired." });
      }

      // Access tokens are short-lived, but a revoked session must stop working immediately.
      const session = await prisma.session.findFirst({
        where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
        select: {
          user: {
            select: {
              id: true,
              bakeryId: true,
              email: true,
              name: true,
              role: true,
              isActive: true,
              bakery: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  timezone: true,
                  currency: true,
                  customDomain: true,
                },
              },
            },
          },
        },
      });

      if (!session?.user.isActive || session.user.role === "CUSTOMER") {
        throw new UnauthorizedException({
          code: "SESSION_REVOKED",
          message: "Session is no longer valid.",
        });
      }
      if (session.user.bakeryId !== payload.bakeryId) {
        throw new ForbiddenException({ code: "TENANT_MISMATCH", message: "Tenant mismatch." });
      }

      // The JWT is authoritative for admin requests; the host/header is a hint only.
      apiReq.bakery = session.user.bakery;
      apiReq.user = {
        id: session.user.id,
        bakeryId: session.user.bakeryId,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role as StaffRole,
        sessionId: payload.sid,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireTenant: RequestHandler = (req, _res, next) => {
  const apiReq = req as ApiRequest;

  if (apiReq.user) {
    if (apiReq.bakery && apiReq.bakery.id !== apiReq.user.bakeryId) {
      next(
        new ForbiddenException({
          code: "TENANT_MISMATCH",
          message: "You do not have access to this bakery.",
        }),
      );
      return;
    }
    next();
    return;
  }

  if (!apiReq.bakery) {
    next(
      new BadRequestException({
        code: "TENANT_REQUIRED",
        message: "A bakery context is required. Provide x-bakery-slug or use a mapped domain.",
      }),
    );
    return;
  }
  next();
};

export function requireRole(...roles: StaffRole[]): RequestHandler {
  return (req, _res, next) => {
    const user = (req as ApiRequest).user;
    if (!user || !roles.includes(user.role)) {
      next(
        new ForbiddenException({
          code: "INSUFFICIENT_ROLE",
          message: "Your role cannot perform this action.",
        }),
      );
      return;
    }
    next();
  };
}

/**
 * Runs the rest of the request inside an AsyncLocalStorage tenant scope. Any
 * future service that calls `TenantContextService.requireId()` gets the tenant
 * resolved here instead of trusting a client-supplied id.
 */
export function tenantScope(tenant: TenantContextService): RequestHandler {
  return (req, _res, next) => {
    const apiReq = req as ApiRequest;
    const bakeryId = apiReq.user?.bakeryId ?? apiReq.bakery?.id;
    if (!bakeryId) {
      next();
      return;
    }
    tenant.run(
      { bakeryId, slug: apiReq.bakery?.slug ?? "unknown", requestId: apiReq.requestId },
      next,
    );
  };
}

export interface Guards {
  internalKey: RequestHandler;
  authenticate: RequestHandler;
  requireTenant: RequestHandler;
  role: (...roles: StaffRole[]) => RequestHandler;
  /** Public route that still needs a bakery (storefront, slots, bookings). */
  publicTenant: RequestHandler[];
  /** Public route that is not tenant-scoped (refresh, logout). */
  publicNoTenant: RequestHandler[];
  /** Staff-only route. */
  admin: (...roles: StaffRole[]) => RequestHandler[];
}

export function createGuards(deps: {
  config: AppConfig;
  prisma: PrismaService;
  tenant: TenantContextService;
}): Guards {
  const scope = tenantScope(deps.tenant);
  const key = internalKey(deps.config);
  const auth = authenticate(deps.config, deps.prisma);

  return {
    internalKey: key,
    authenticate: auth,
    requireTenant,
    role: (...roles) => requireRole(...roles),
    publicTenant: [key, requireTenant, scope],
    publicNoTenant: [key, scope],
    admin: (...roles) => [key, auth, requireTenant, requireRole(...roles), scope],
  };
}

function extractToken(req: ApiRequest): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.["cf_access"];
}

function subdomain(host: string): string | null {
  const parts = host.split(".");
  if (parts.length < 3 && !host.endsWith(".localhost")) return null;
  const label = parts[0]!;
  return label === "www" || label === "app" ? null : label;
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
