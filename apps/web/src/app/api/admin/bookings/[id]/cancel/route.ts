import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import type { ApiErrorBody } from "@cakeflow/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { ACCESS_COOKIE, BAKERY_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  refund: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  const tenantSlug = cookies().get(BAKERY_COOKIE)?.value ?? "sweetcrumbs";
  if (!token) return unauthorised();

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Invalid cancellation request.",
        details: parsed.error.flatten(),
      } satisfies ApiErrorBody,
      { status: 400 },
    );
  }

  try {
    const result = await apiFetch(`/v1/admin/bookings/${encodeURIComponent(params.id)}/cancel`, {
      method: "POST",
      body: parsed.data,
      accessToken: token,
      tenantSlug,
    });
    return NextResponse.json(result);
  } catch (caught) {
    if (caught instanceof ApiError) {
      return NextResponse.json(caught.body, { status: caught.status });
    }
    return NextResponse.json(
      { statusCode: 502, code: "UPSTREAM_UNAVAILABLE", message: "Cancellation failed." },
      { status: 502 },
    );
  }
}

function unauthorised(): NextResponse {
  return NextResponse.json(
    { statusCode: 401, code: "AUTH_REQUIRED", message: "Sign in required." },
    { status: 401 },
  );
}
