import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { apiFetch, ApiError } from "@/lib/api";
import { ACCESS_COOKIE, BAKERY_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ capacity: z.number().int().min(1).max(200) });

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const token = cookies().get(ACCESS_COOKIE)?.value;
  const tenantSlug = cookies().get(BAKERY_COOKIE)?.value ?? "sweetcrumbs";
  if (!token) {
    return NextResponse.json(
      { statusCode: 401, code: "AUTH_REQUIRED", message: "Sign in required." },
      { status: 401 },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { statusCode: 400, code: "VALIDATION_ERROR", message: "Capacity must be between 1 and 200." },
      { status: 400 },
    );
  }

  try {
    const result = await apiFetch(`/v1/admin/slots/${encodeURIComponent(params.id)}`, {
      method: "PATCH",
      body: parsed.data,
      accessToken: token,
      tenantSlug,
    });
    return NextResponse.json(result);
  } catch (caught) {
    if (caught instanceof ApiError) return NextResponse.json(caught.body, { status: caught.status });
    return NextResponse.json(
      { statusCode: 502, code: "UPSTREAM_UNAVAILABLE", message: "Could not update capacity." },
      { status: 502 },
    );
  }
}
