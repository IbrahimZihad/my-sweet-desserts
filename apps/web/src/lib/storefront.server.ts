import { apiFetch } from "./api";
import { resolveTenantSlug } from "./tenant";
import type { Storefront } from "./storefront";

export async function getStorefront(): Promise<Storefront> {
  return apiFetch<Storefront>("/v1/storefront", { tenantSlug: resolveTenantSlug() });
}
