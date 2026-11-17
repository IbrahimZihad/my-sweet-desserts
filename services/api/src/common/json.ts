/**
 * SQLite has no native JSON column type (Prisma's sqlite connector rejects
 * `Json`), so JSON-shaped fields are stored as TEXT. Keep the encoding in one
 * place: write with `toJsonText`, read with `fromJsonText`.
 */

export function toJsonText(value: unknown): string {
  return JSON.stringify(value);
}

/** Returns `fallback` for null/empty/invalid payloads instead of throwing. */
export function fromJsonText<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Same as `fromJsonText`, but keeps "no value" distinct from "empty object". */
export function fromJsonTextOrNull<T>(value: string | null | undefined): T | null {
  return fromJsonText<T | null>(value, null);
}
