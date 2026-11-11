import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import type { Bakery } from "@prisma/client";

export interface RequestWithContext extends Request {
  requestId: string;
  bakery?: Pick<Bakery, "id" | "slug" | "name" | "timezone" | "currency" | "customDomain">;
}

interface CacheEntry {
  bakery: RequestWithContext["bakery"];
  expiresAt: number;
}

/**
 * Resolves the tenant from (in order):
 *   1. `x-bakery-slug` — set by the Next.js BFF, never trusted for authorisation
 *   2. exact custom domain match
 *   3. subdomain label (`sweetcrumbs.cakeflow.app`)
 *
 * The resolved bakery is only a routing hint. The JWT guard additionally
 * verifies that an admin's `bakeryId` matches this tenant.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async use(req: RequestWithContext, _res: Response, next: NextFunction): Promise<void> {
    req.requestId = req.header("x-request-id") ?? randomUUID();

    const slugHeader = req.header("x-bakery-slug")?.toLowerCase().trim();
    const host = (req.header("x-forwarded-host") ?? req.header("host") ?? "")
      .split(",")[0]!
      .split(":")[0]!
      .toLowerCase();

    try {
      if (slugHeader) {
        req.bakery = await this.bySlug(slugHeader);
      } else if (host) {
        req.bakery = (await this.byCustomDomain(host)) ?? (await this.bySlug(this.subdomain(host)));
      }
    } catch {
      // Tenant resolution must never take down the request; the guard returns
      // a typed TENANT_REQUIRED error instead.
    }

    next();
  }

  private subdomain(host: string): string | null {
    const parts = host.split(".");
    if (parts.length < 3 && !host.endsWith(".localhost")) return null;
    const label = parts[0]!;
    return label === "www" || label === "app" ? null : label;
  }

  private async bySlug(slug: string | null): Promise<RequestWithContext["bakery"]> {
    if (!slug) return undefined;
    const cached = this.cache.get(`slug:${slug}`);
    if (cached && cached.expiresAt > Date.now()) return cached.bakery;

    const bakery = await this.prisma.bakery.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, timezone: true, currency: true, customDomain: true },
    });
    if (bakery) this.cache.set(`slug:${slug}`, { bakery, expiresAt: Date.now() + this.ttlMs });
    return bakery ?? undefined;
  }

  private async byCustomDomain(host: string): Promise<RequestWithContext["bakery"]> {
    const cached = this.cache.get(`host:${host}`);
    if (cached && cached.expiresAt > Date.now()) return cached.bakery;

    const bakery = await this.prisma.bakery.findUnique({
      where: { customDomain: host },
      select: { id: true, slug: true, name: true, timezone: true, currency: true, customDomain: true },
    });
    if (bakery) this.cache.set(`host:${host}`, { bakery, expiresAt: Date.now() + this.ttlMs });
    return bakery ?? undefined;
  }
}
