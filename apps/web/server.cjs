#!/usr/bin/env node
/**
 * Single-process production server.
 *
 * The Express API is built by `services/api` and mounted on the same port as
 * Next.js, so the whole app runs as one Render Web Service:
 *
 *   /health, /v1/*  -> Express API (SQLite, Prisma, Stripe webhooks)
 *   everything else -> Next.js (storefront + BFF route handlers)
 *
 * The API is created first because it loads the repository `.env` (when
 * present) into `process.env` before the BFF modules read `API_INTERNAL_URL`.
 */
const http = require("node:http");
const path = require("node:path");
const next = require("next");

async function main() {
  const dir = __dirname;
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  const { createApiApp } = require(path.join(dir, "..", "..", "services", "api", "dist", "app.js"));
  const api = createApiApp();
  await api.initialize();

  // The BFF calls the API over loopback; keep it off the public internet.
  // Always override: in single-process mode this process owns the only API.
  process.env.API_INTERNAL_URL = `http://127.0.0.1:${port}`;

  const nextApp = next({ dev: false, dir, hostname: "0.0.0.0", port });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  // Unmatched API paths fall through to Next.js (pages, static assets, BFF).
  api.app.use((req, res) => handle(req, res));

  const server = http.createServer(api.app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });

  api.startBackgroundJobs();
  console.log(`[cakeflow] web + api listening on :${port}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[cakeflow] ${signal} received, shutting down`);

    await new Promise((resolve) => server.close(resolve));
    await api.close();
    await nextApp.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[cakeflow] failed to start", error);
  process.exit(1);
});
