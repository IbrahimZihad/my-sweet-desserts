import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  createBookingSchema,
  type ApiErrorBody,
  type CreateBookingResponse,
} from "@cakeflow/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { resolveTenantSlugFromHeaders } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bookings
 *
 * The BFF validates the request, applies a per-IP rate limit, supplies an
 * idempotency key, then forwards to NestJS. No payment or database logic lives
 * in Next.js — the browser never talks to the API container directly.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let tenantSlug: string;
  try {
    tenantSlug = resolveTenantSlugFromHeaders(request.headers);
  } catch {
    return error(400, "TENANT_INVALID", "Unknown bakery.");
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const limit = rateLimit(`bookings:${tenantSlug}:${ip}`, 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        statusCode: 429,
        code: "RATE_LIMITED",
        message: "Too many booking attempts. Please wait a minute and try again.",
      } satisfies ApiErrorBody,
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return error(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = createBookingSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Please check the booking details.",
        details: parsed.error.flatten(),
      } satisfies ApiErrorBody,
      { status: 400 },
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? randomUUID();

  try {
    const booking = await apiFetch<CreateBookingResponse>("/v1/bookings", {
      method: "POST",
      body: parsed.data,
      tenantSlug,
      idempotencyKey,
    });
    return NextResponse.json(booking, {
      status: 201,
      headers: { "x-idempotency-key": idempotencyKey },
    });
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    console.error("POST /api/bookings failed", caught);
    return error(502, "UPSTREAM_UNAVAILABLE", "The booking service is temporarily unavailable.");
  }
}

function error(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ statusCode: status, code, message } satisfies ApiErrorBody, { status });
}
