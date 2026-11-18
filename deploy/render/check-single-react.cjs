#!/usr/bin/env node
/**
 * Fails when the workspace resolves more than one copy of React.
 *
 * Two React copies make `react-dom`'s renderer and the application's React
 * disagree about the current hooks dispatcher. Next.js then dies during static
 * prerendering with "Cannot read properties of null (reading 'useContext')"
 * and "<Html> should not be imported outside of pages/_document", which says
 * nothing about the real cause.
 *
 * A duplicate normally means the build reused a stale node_modules directory
 * (a cached build from a different lockfile or package-manager version), not
 * that the lockfile is wrong. `deploy/render/build-web.sh` wipes node_modules
 * and retries once when this check fails.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const webDir = path.join(root, "apps", "web");

function resolvePackageJson(request, from) {
  return require.resolve(request, { paths: [from] });
}

function real(file) {
  return fs.realpathSync(file);
}

const reactForApp = real(resolvePackageJson("react/package.json", webDir));
const reactDom = real(resolvePackageJson("react-dom/package.json", webDir));
// This mirrors what react-dom itself does: require("react") from its own folder.
const reactForReactDom = real(
  resolvePackageJson("react/package.json", path.dirname(reactDom)),
);

if (reactForApp !== reactForReactDom) {
  console.error("[check] duplicate React detected:");
  console.error(`[check]   app        -> ${reactForApp}`);
  console.error(`[check]   react-dom  -> ${reactForReactDom}`);
  process.exit(1);
}

console.log(`[check] single React instance: ${reactForApp}`);
