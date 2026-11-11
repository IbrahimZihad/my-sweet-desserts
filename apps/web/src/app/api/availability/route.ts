import { NextResponse } from "next/server";
import {
  availabilityQuerySchema,
  type ApiErrorBody,
  type AvailabilityResponse,
} from "@cakeflow/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { resolveTenantSlugFromHeaders } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const parsed = availabilityQuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    cakeId: url.searchParams.get("cakeId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Invalid availability query.",
        details: parsed.error.flatten(),
      } satisfies ApiErrorBody,
      { status: 400 },
    );
  }

  const query = new URLSearchParams({
    from: parsed.data.from,
    to: parsed.data.to,
    ...(parsed.data.cakeId ? { cakeId: parsed.data.cakeId } : {}),
  });

  try {
    const availability = await apiFetch<AvailabilityResponse>(`/v1/slots?${query}`, {
      tenantSlug: resolveTenantSlugFromHeaders(request.headers),
    });
    return NextResponse.json(availability, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    return NextResponse.json(
      {
        statusCode: 502,
        code: "UPSTREAM_UNAVAILABLE",
        message: "Availability could not be loaded.",
      } satisfies ApiErrorBody,
      { status: 502 },
    );
  }
}
