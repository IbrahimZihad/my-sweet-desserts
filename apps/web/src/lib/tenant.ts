import { headers } from "next/headers";

/**
 * Resolves the bakery for the current request.
 *
 * Order:
 *   1. `x-bakery-slug` / `x-tenant-slug` (set by our own routes or a proxy)
 *   2. `<slug>.localhost` (development)
 *   3. `<slug>.<TENANT_BASE_DOMAIN>` (opt-in subdomain routing)
 *   4. `DEFAULT_BAKERY_SLUG`
 *
 * Platform hostnames are deliberately *not* treated as tenant subdomains.
 * `cakeflow.onrender.com`, `cakeflow.vercel.app` and friends have three or
 * more labels, so a "three labels means subdomain" rule turns the service
 * name into a bakery slug ("cakeflow") that does not exist, and every
 * storefront request fails with `TENANT_REQUIRED`.
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

  const slug = slugFromHost(host);
  if (slug) return sanitizeSlug(slug);

  return sanitizeSlug(process.env.DEFAULT_BAKERY_SLUG ?? "sweetcrumbs");
}

/**
 * Returns the tenant label for a host, or null when the host is the platform
 * itself (an IP, a bare domain, or a shared host such as `*.onrender.com`).
 */
function slugFromHost(host: string): string | null {
  if (!host) return null;

  // An IPv4/IPv6 literal is never a tenant subdomain: 127.0.0.1 has three dots
  // but "127" is not a bakery.
  if (isIpLiteral(host)) return null;

  if (host.endsWith(".localhost")) return firstLabel(host);

  const base = normalizeBaseDomain(process.env.TENANT_BASE_DOMAIN);
  if (base && host.endsWith(`.${base}`)) {
    return firstLabel(host.slice(0, -(base.length + 1)));
  }

  // `www.example.com` and `example.com` both use the default bakery.
  return null;
}

function firstLabel(host: string): string | null {
  const label = host.split(".")[0] ?? "";
  return label && label !== "www" && label !== "app" ? label : null;
}

function normalizeBaseDomain(value: string | undefined): string | null {
  if (!value) return null;
  const base = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\.+|\.+$/g, "");
  return base.includes(".") ? base : null;
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
}

function sanitizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error("Invalid bakery slug");
  }
  return slug;
}
