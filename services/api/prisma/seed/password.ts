import { randomBytes, scryptSync } from "node:crypto";

/**
 * Must stay byte-compatible with `AuthService.hashPassword`:
 * `scrypt$<salt-hex>$<derived-key-hex>`.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}
