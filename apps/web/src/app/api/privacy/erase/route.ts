import { NextResponse } from "next/server";
import {
  privacyErasureSchema,
  type ApiErrorBody,
  type PrivacyErasureResponse,
} from "@cakeflow/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { resolveTenantSlugFromHeaders } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/privacy/erase — GDPR Art. 17 erasure (anonymises PII). */
export async function POST(request: Request): Promise<NextResponse> {
  let tenantSlug: string;
  try {
    tenantSlug = resolveTenantSlugFromHeaders(request.headers);
  } catch {
    return fail(400, "TENANT_INVALID", "Unknown bakery.");
  }

  const ip = clientIp(request);
  const limit = rateLimit(`privacy-erase:${tenantSlug}:${ip}`, 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        statusCode: 429,
        code: "RATE_LIMITED",
        message: "Too many privacy requests. Please wait a minute and try again.",
      } satisfies ApiErrorBody,
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = privacyErasureSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Confirm the erasure request and enter the booking details.",
        details: parsed.error.flatten(),
      } satisfies ApiErrorBody,
      { status: 400 },
    );
  }

  try {
    const data = await apiFetch<PrivacyErasureResponse>("/v1/privacy/erase", {
      method: "POST",
      body: parsed.data,
      tenantSlug,
    });
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    console.error("POST /api/privacy/erase failed", caught);
    return fail(502, "UPSTREAM_UNAVAILABLE", "The erasure request could not be completed. Please try again.");
  }
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ statusCode: status, code, message } satisfies ApiErrorBody, { status });
}
