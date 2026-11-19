#!/usr/bin/env node
/**
 * Runs `next build` with NODE_ENV pinned to "production".
 *
 * Next 14 picks its React runtime from NODE_ENV. When the value is exactly
 * "development", the production build loads `app-page.runtime.dev.js` and
 * static prerendering fails with errors that never mention the environment:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Error: <Html> should not be imported outside of pages/_document.
 *
 * Hosts such as Render let you set NODE_ENV in the dashboard, and a leftover
 * `NODE_ENV=development` in a build shell (or a stale dev server export) is
 * enough to trigger it. Pinning it here means `pnpm build`,
 * `pnpm --filter @cakeflow/web build` and CI all behave the same.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const requested = process.env.NODE_ENV;
if (requested !== "production") {
  console.log(
    `[build] NODE_ENV=${requested === undefined ? "(unset)" : JSON.stringify(requested)} -> forcing "production"`,
  );
}

const env = { ...process.env, NODE_ENV: "production" };
const nextBin = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build", appDir], {
  cwd: appDir,
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error("[build] could not start next:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
