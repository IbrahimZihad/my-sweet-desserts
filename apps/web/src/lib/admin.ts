import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiFetch, ApiError } from "./api";
import { ACCESS_COOKIE, BAKERY_COOKIE } from "./auth";
import { resolveTenantSlug } from "./tenant";

/** Server-component API client for the admin area. Redirects on auth failure. */
export async function adminApi<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<T> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/admin/login");

  const tenantSlug = cookies().get(BAKERY_COOKIE)?.value ?? resolveTenantSlug();

  try {
    return await apiFetch<T>(path, { ...options, accessToken: token, tenantSlug });
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) redirect("/admin/login");
    throw caught;
  }
}
