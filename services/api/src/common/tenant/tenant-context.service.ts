import { ForbiddenException } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  bakeryId: string;
  slug: string;
  requestId: string;
}

/**
 * Request-scoped tenant carrier.
 *
 * Guards populate this after auth/tenant resolution. Any service that touches
 * tenant-owned data must call `requireId()` — there is deliberately no default
 * tenant. This makes an unscoped query a runtime error instead of a data leak.
 */
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, fn: () => T): T {
    return this.als.run(context, fn);
  }

  get(): TenantContext | undefined {
    return this.als.getStore();
  }

  require(): TenantContext {
    const ctx = this.als.getStore();
    if (!ctx) {
      throw new ForbiddenException({
        code: "TENANT_CONTEXT_MISSING",
        message: "Request is not bound to a bakery.",
      });
    }
    return ctx;
  }

  requireId(): string {
    return this.require().bakeryId;
  }
}
