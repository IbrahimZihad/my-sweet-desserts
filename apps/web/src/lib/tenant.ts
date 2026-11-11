import { headers } from "next/headers";

/**
 * Resolves the bakery for the current request.
 *
 * MVP strategy: subdomain (`sweetcrumbs.localhost`) or explicit BFF header,
 * with a development fallback. Custom-domain routing can be added by resolving
 * the host against Bakery.customDomain before falling back to the slug.
 */
export function resolveTenantSlug(): string {
  return resolveTenantSlugFromHeaders(headers());
}

export function resolveTenantSlugFromHeaders(headersList: Headers): string {
  const explicit =
    headersList.get("x-bakery-slug") ?? headersList.get("x-tenant-slug");
  if (explicit) return sanitizeSlug(explicit);

  const host = (headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "")
    .split(",")[0]!
    .trim()
    .toLowerCase()
    .split(":")[0]!;

  const labels = host.split(".");
  // An IPv4/IPv6 literal is never a tenant subdomain: 127.0.0.1 has three dots
  // but "127" is not a bakery. Fall back to the default tenant instead.
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
  const isSubdomain = !isIpLiteral && (host.endsWith(".localhost") || labels.length >= 3);
  if (isSubdomain) {
    const label = labels[0]!;
    if (label && label !== "www" && label !== "app") return sanitizeSlug(label);
  }

  return sanitizeSlug(process.env.DEFAULT_BAKERY_SLUG ?? "sweetcrumbs");
}

function sanitizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error("Invalid bakery slug");
  }
  return slug;
}
