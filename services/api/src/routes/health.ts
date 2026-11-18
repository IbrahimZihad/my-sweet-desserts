import type { PrismaService } from "../prisma/prisma.service";
import { Router } from "express";

/** Liveness/readiness probe. Outside the `/v1` prefix and unauthenticated. */
export function createHealthRouter(prisma: PrismaService): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const startedAt = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: "ok",
        database: "up",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: "error",
        database: "down",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
