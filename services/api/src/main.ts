import type { Server } from "node:http";
import { createApiApp } from "./app";
import { Logger } from "./common/logger";

const logger = new Logger("bootstrap");

async function bootstrap(): Promise<void> {
  const api = createApiApp();
  await api.initialize();

  // Standalone mode has no Next.js fallback, so unmatched routes are 404s.
  api.app.use((_req, res) => {
    res.status(404).json({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Route not found.",
    });
  });

  const port = api.config.PORT;
  const server: Server = api.app.listen(port, "0.0.0.0", () => {
    logger.log(`CakeFlow API listening on :${port}`);
    api.startBackgroundJobs();
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`${signal} received, shutting down`);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await api.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  logger.error("Failed to start the API", error);
  process.exit(1);
});
