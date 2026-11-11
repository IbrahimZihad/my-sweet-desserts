import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@cakeflow/contracts";

export const IS_PUBLIC_KEY = "isPublic";
export const SKIP_TENANT_KEY = "skipTenant";
export const ROLES_KEY = "roles";

/** Bypasses JWT authentication (still tenant-scoped unless @SkipTenant is used). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** For endpoints that are not tenant-scoped at all (health, Stripe webhooks). */
export const SkipTenant = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_TENANT_KEY, true);

export const Roles = (...roles: Array<Extract<UserRole, "OWNER" | "STAFF">>) =>
  SetMetadata(ROLES_KEY, roles);
