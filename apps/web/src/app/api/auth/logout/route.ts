import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiFetch } from "@/lib/api";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const refreshToken = cookies().get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      await apiFetch("/v1/auth/logout", {
        method: "POST",
        body: { refreshToken },
      });
    } catch {
      // Clearing cookies is the important part; the session will expire anyway.
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ACCESS_COOKIE);
  // The refresh cookie is scoped to /api/auth, so it needs an explicit path.
  response.cookies.set(REFRESH_COOKIE, "", { path: "/api/auth", maxAge: 0 });
  return response;
}
