import { cookies } from "next/headers";
import type { AuthUserDto } from "@cakeflow/contracts";
import { apiFetch, ApiError } from "./api";
import { resolveTenantSlug } from "./tenant";

export const ACCESS_COOKIE = "cf_access";
export const REFRESH_COOKIE = "cf_refresh";
export const BAKERY_COOKIE = "cf_bakery";

export async function getAdminSession(): Promise<AuthUserDto | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    return await apiFetch<AuthUserDto>("/v1/auth/me", {
      accessToken: token,
      tenantSlug: cookieStore.get(BAKERY_COOKIE)?.value ?? resolveTenantSlug(),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function requireAdminSession(): Promise<AuthUserDto> {
  const session = await getAdminSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}
