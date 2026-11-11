import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiErrorBody, BookingSummaryDto } from "@cakeflow/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { resolveTenantSlugFromHeaders } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailSchema = z.string().email().transform((value) => value.toLowerCase().trim());

export async function GET(
  request: Request,
  { params }: { params: { reference: string } },
): Promise<NextResponse> {
  const email = emailSchema.safeParse(new URL(request.url).searchParams.get("email"));
  if (!email.success) {
    return fail(400, "EMAIL_REQUIRED", "An email address is required to view this booking.");
  }

  try {
    const booking = await apiFetch<BookingSummaryDto>(
      `/v1/bookings/${encodeURIComponent(params.reference)}?email=${encodeURIComponent(email.data)}`,
      { tenantSlug: resolveTenantSlugFromHeaders(request.headers) },
    );
    return NextResponse.json(booking, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    return fail(502, "UPSTREAM_UNAVAILABLE", "Booking could not be loaded.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: { reference: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "INVALID_JSON", "Invalid request body.");
  }

  const email = emailSchema.safeParse((body as { email?: unknown })?.email);
  if (!email.success) return fail(400, "EMAIL_REQUIRED", "Email is required.");

  try {
    const result = await apiFetch(
      `/v1/bookings/${encodeURIComponent(params.reference)}/cancel`,
      {
        method: "POST",
        body: { email: email.data },
        tenantSlug: resolveTenantSlugFromHeaders(request.headers),
      },
    );
    return NextResponse.json(result);
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    return fail(502, "UPSTREAM_UNAVAILABLE", "Cancellation failed.");
  }
}

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ statusCode: status, code, message } satisfies ApiErrorBody, { status });
}
