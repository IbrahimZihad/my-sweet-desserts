import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { LoginResponse } from "@cakeflow/contracts";
import { apiFetch, ApiError, cookieOptions } from "@/lib/api";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

/** Rotates the refresh token and issues a fresh 15-minute access cookie. */
export async function POST(): Promise<NextResponse> {
  const refreshToken = cookies().get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      { statusCode: 401, code: "NO_SESSION", message: "Not signed in." },
      { status: 401 },
    );
  }

  try {
    const session = await apiFetch<LoginResponse>("/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });

    const response = NextResponse.json({ user: session.user });
    response.cookies.set(ACCESS_COOKIE, session.accessToken, cookieOptions(session.expiresIn));
    response.cookies.set(
      REFRESH_COOKIE,
      session.refreshToken,
      cookieOptions(REFRESH_MAX_AGE, "/api/auth"),
    );
    return response;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      const response = NextResponse.json(caught.body, { status: 401 });
      response.cookies.delete(ACCESS_COOKIE);
      response.cookies.delete(REFRESH_COOKIE);
      return response;
    }
    return NextResponse.json(
      { statusCode: 502, code: "REFRESH_FAILED", message: "Could not refresh session." },
      { status: 502 },
    );
  }
}
