import type { Request, RequestHandler } from "express";
import { ApiError } from "./errors";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitOptions {
  /** Namespace so two limits on the same key do not share a counter. */
  name: string;
  windowMs: number;
  max: number;
  /** Defaults to the client IP. */
  key?: (req: Request) => string;
}

/**
 * Fixed-window in-memory limiter. This is a single-process deployment, so a
 * process-local map is enough; it is not a distributed rate limiter.
 *
 * Callers behind the Next.js BFF all share the loopback address, so routes that
 * identify a person (login, booking) key on the submitted email as well as the
 * IP instead of the IP alone.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const identity = options.key ? options.key(req) : req.ip ?? "unknown";
    const id = `${options.name}:${identity}`;

    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_BUCKETS) prune(now);
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(id, bucket);
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      next(
        new ApiError(429, {
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait a moment and try again.",
        }),
      );
      return;
    }

    next();
  };
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_BUCKETS) buckets.clear();
}

/** Reads a string field from an already-parsed JSON body, if present. */
export function bodyString(req: Request, field: string): string {
  const body: unknown = req.body;
  if (!body || typeof body !== "object") return "anonymous";
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value.toLowerCase().slice(0, 200) : "anonymous";
}
