import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateSlotsSchema } from "@cakeflow/contracts";
import { apiFetch, ApiError } from "@/lib/api";
import { ACCESS_COOKIE, BAKERY_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  const tenantSlug = cookies().get(BAKERY_COOKIE)?.value ?? "sweetcrumbs";
  if (!token) {
    return NextResponse.json(
      { statusCode: 401, code: "AUTH_REQUIRED", message: "Sign in required." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { statusCode: 400, code: "INVALID_JSON", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = generateSlotsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Check the slot generation settings.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const result = await apiFetch("/v1/admin/slots/generate", {
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
      { statusCode: 502, code: "UPSTREAM_UNAVAILABLE", message: "Could not generate slots." },
      { status: 502 },
    );
  }
}
