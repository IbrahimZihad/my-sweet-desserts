import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_DOMAIN: z.string().default("localhost"),
  INTERNAL_API_KEY: z.string().min(24),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(0),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("CakeFlow <bookings@example.com>"),

  // Privacy retention job (GDPR Art. 5(1)(e))
  STRIPE_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Validates configuration and returns a plain typed object. Replaces the
 * NestJS `ConfigService` so services can use `config.JWT_ACCESS_SECRET`.
 *
 * When running outside Render, the repo-root `.env` is loaded if present.
 * Render injects the variables directly, so no file is needed there.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadEnvFile(env);

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Walks up from the working directory looking for a `.env` file. */
function loadEnvFile(env: NodeJS.ProcessEnv): void {
  if (env !== process.env) return;

  let directory = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(directory, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
