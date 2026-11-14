import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import type { ApiErrorBody, BookingAnnouncementsResponse } from "@cakeflow/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { ACCESS_COOKIE, BAKERY_COOKIE } from "@/lib/auth";
import { resolveTenantSlugFromHeaders } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
});

/** GET /api/admin/announcements — polling feed for the spoken dashboard. */
export async function GET(request: Request): Promise<NextResponse> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Sign in required.");
  }

  let tenantSlug: string;
  try {
    tenantSlug =
      cookies().get(BAKERY_COOKIE)?.value ?? resolveTenantSlugFromHeaders(request.headers);
  } catch {
    return fail(400, "TENANT_INVALID", "Unknown bakery.");
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ since: url.searchParams.get("since") ?? undefined });
  if (!parsed.success) {
    return fail(400, "VALIDATION_ERROR", "Invalid announcement cursor.");
  }

  const query = new URLSearchParams();
  if (parsed.data.since) query.set("since", parsed.data.since);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  try {
    const data = await apiFetch<BookingAnnouncementsResponse>(
      `/v1/admin/bookings/announcements${suffix}`,
      { accessToken: token, tenantSlug },
    );
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    console.error("GET /api/admin/announcements failed", caught);
    return fail(502, "UPSTREAM_UNAVAILABLE", "Announcements are temporarily unavailable.");
  }
}

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ statusCode: status, code, message } satisfies ApiErrorBody, { status });
}
