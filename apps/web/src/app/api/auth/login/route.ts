import { NextResponse } from "next/server";
import {
  loginSchema,
  type ApiErrorBody,
  type LoginResponse,
} from "@cakeflow/contracts";
import { apiFetch, ApiError, cookieOptions } from "@/lib/api";
import { ACCESS_COOKIE, BAKERY_COOKIE, REFRESH_COOKIE } from "@/lib/auth";
import { resolveTenantSlugFromHeaders } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "INVALID_JSON", "Invalid request body.");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Enter a valid email and password.",
        details: parsed.error.flatten(),
      } satisfies ApiErrorBody,
      { status: 400 },
    );
  }

  const tenantSlug = resolveTenantSlugFromHeaders(request.headers);

  try {
    const session = await apiFetch<LoginResponse>("/v1/auth/login", {
      method: "POST",
      body: parsed.data,
      tenantSlug,
    });

    const response = NextResponse.json({ user: session.user });
    response.cookies.set(ACCESS_COOKIE, session.accessToken, cookieOptions(session.expiresIn));
    response.cookies.set(
      REFRESH_COOKIE,
      session.refreshToken,
      cookieOptions(REFRESH_MAX_AGE, "/api/auth"),
    );
    response.cookies.set(BAKERY_COOKIE, tenantSlug, cookieOptions(REFRESH_MAX_AGE));
    return response;
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    console.error("Admin login failed", caught);
    return fail(502, "UPSTREAM_UNAVAILABLE", "Login is temporarily unavailable.");
  }
}

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ statusCode: status, code, message } satisfies ApiErrorBody, { status });
}
