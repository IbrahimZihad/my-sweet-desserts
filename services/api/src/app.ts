import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router, type Express } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { createGuards, requestContext, type ApiRequest } from "./common/auth";
import { errorHandler } from "./common/error-handler";
import { Logger } from "./common/logger";
import { TenantContextService } from "./common/tenant/tenant-context.service";
import { loadConfig, type AppConfig } from "./config/env";
import { PrismaService } from "./prisma/prisma.service";
import { createAuthRouter } from "./routes/auth";
import { createBookingsRouter } from "./routes/bookings";
import { createHealthRouter } from "./routes/health";
import { createPaymentsRouter } from "./routes/payments";
import { createPrivacyRouter } from "./routes/privacy";
import { createSlotsRouter } from "./routes/slots";
import { createStorefrontRouter } from "./routes/storefront";
import { createServices, type Services } from "./services";

export interface CakeFlowApi {
  /** Express app with `/health`, `/v1/*` and the API error handler. */
  app: Express;
  config: AppConfig;
  prisma: PrismaService;
  services: Services;
  /** Opens the SQLite file and fails fast on a bad `DATABASE_URL`. */
  initialize(): Promise<void>;
  /** Starts the in-process schedulers. Safe to call once. */
  startBackgroundJobs(): void;
  /** Stops schedulers and disconnects Prisma. */
  close(): Promise<void>;
}

/**
 * Builds the whole HTTP API without opening a socket.
 *
 * The same function backs both deployment shapes:
 *  - standalone (`main.ts` listens on `PORT`)
 *  - single-process (`apps/web/server.cjs` mounts the returned app and adds
 *    the Next.js request handler after the API routes)
 */
export function createApiApp(env: NodeJS.ProcessEnv = process.env): CakeFlowApi {
  const config = loadConfig(env);
  const logger = new Logger("api");
  const prisma = new PrismaService();
  const tenant = new TenantContextService();
  const services = createServices(config, prisma);
  const guards = createGuards({ config, prisma, tenant });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // Every response (including `/health`) carries a correlation id.
  app.use((req, res, next) => {
    const apiReq = req as ApiRequest;
    apiReq.requestId = req.header("x-request-id") ?? randomUUID();
    res.setHeader("x-request-id", apiReq.requestId);
    next();
  });

  app.use("/health", createHealthRouter(prisma));

  const v1 = Router();
  v1.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  v1.use(
    cors({
      origin: config.WEB_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "x-bakery-slug",
        "x-request-id",
      ],
      exposedHeaders: ["x-request-id"],
      maxAge: 600,
    }),
  );
  v1.use(cookieParser());

  // Request id + tenant hint first, so even a malformed body gets a request id.
  v1.use(requestContext(prisma));
  // `verify` keeps the exact bytes Stripe signs. Mounted only on `/v1`, so it
  // never consumes the body of a Next.js request in single-process mode.
  v1.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buffer) => {
        (req as unknown as ApiRequest).rawBody = Buffer.from(buffer);
      },
    }),
  );

  v1.use(createAuthRouter(services, guards));
  v1.use(createStorefrontRouter(prisma, guards));
  v1.use(createSlotsRouter(services, guards));
  v1.use(createBookingsRouter(services, guards));
  v1.use(createPaymentsRouter(services, guards));
  v1.use(createPrivacyRouter(services, guards));
  v1.use(errorHandler());

  app.use("/v1", v1);

  const timers = new Set<NodeJS.Timeout>();
  let jobsStarted = false;

  const runSafely = async (name: string, task: () => Promise<unknown>): Promise<void> => {
    try {
      await task();
    } catch (error) {
      logger.error(`Background job "${name}" failed`, error);
    }
  };

  const every = (name: string, intervalMs: number, task: () => Promise<unknown>): void => {
    const timer = setInterval(() => void runSafely(name, task), intervalMs);
    timer.unref();
    timers.add(timer);
  };

  /** First run at the next `hourUtc:00`, then every 24 hours. */
  const dailyAt = (hourUtc: number, name: string, task: () => Promise<unknown>): void => {
    const next = new Date();
    next.setUTCHours(hourUtc, 0, 0, 0);
    let delay = next.getTime() - Date.now();
    if (delay <= 0) delay += 86_400_000;

    const first = setTimeout(() => {
      timers.delete(first);
      void runSafely(name, task);
      every(name, 86_400_000, task);
    }, delay);
    first.unref();
    timers.add(first);
  };

  return {
    app,
    config,
    prisma,
    services,

    async initialize(): Promise<void> {
      await prisma.connect();
    },

    startBackgroundJobs(): void {
      if (jobsStarted) return;
      jobsStarted = true;

      every("expire-booking-holds", 60_000, () => services.bookings.expireStaleHolds());
      every("email-outbox", 30_000, () => services.notifications.processOutbox());
      dailyAt(3, "privacy-retention", () => services.privacy.runRetention());
      dailyAt(3, "prune-sessions", () => services.auth.pruneSessions());

      // Drain anything left over from the previous process straight away.
      void runSafely("expire-booking-holds", () => services.bookings.expireStaleHolds());
      void runSafely("email-outbox", () => services.notifications.processOutbox());
    },

    async close(): Promise<void> {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await prisma.disconnect();
    },
  };
}
