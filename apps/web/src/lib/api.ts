import type { ApiErrorBody, LoginResponse } from "@cakeflow/contracts";

export const serverEnv = {
  apiUrl:
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000",
  internalKey: process.env.INTERNAL_API_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  defaultBakerySlug: process.env.DEFAULT_BAKERY_SLUG ?? "sweetcrumbs",
  isProduction: process.env.NODE_ENV === "production",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = "ApiError";
  }
}

interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  tenantSlug?: string;
  accessToken?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Server-only typed client for the NestJS API. Every call carries the BFF key
 * so the API container cannot be used directly from the internet.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-internal-key": serverEnv.internalKey,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.tenantSlug) headers["x-bakery-slug"] = options.tenantSlug;
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  const response = await fetch(`${serverEnv.apiUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: options.signal,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body =
      payload && typeof payload === "object"
        ? (payload as ApiErrorBody)
        : {
            statusCode: response.status,
            code: "UPSTREAM_ERROR",
            message: "The booking service is unavailable.",
          };
    throw new ApiError(response.status, body);
  }

  return payload as T;
}

export function cookieOptions(maxAgeSeconds: number, path = "/") {
  return {
    httpOnly: true,
    secure: serverEnv.isProduction,
    sameSite: "lax" as const,
    path,
    maxAge: maxAgeSeconds,
  };
}

export type { LoginResponse };
