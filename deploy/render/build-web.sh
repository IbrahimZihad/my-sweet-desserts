#!/usr/bin/env bash
#
# Render build step for the CakeFlow web app (Next.js, native Node runtime).
#
# Two things this script protects against:
#
#  1. NODE_ENV must be exactly "production" while `next build` runs. Any other
#     value (including a dashboard override such as "Production") makes Next
#     mix its production and development server runtimes, and static
#     prerendering then fails with "Cannot read properties of null (reading
#     'useContext')".
#  2. node_modules must contain exactly one copy of React. Render caches
#     node_modules between builds, and a directory left over from a different
#     lockfile/package-manager version can keep a second React, which fails
#     prerendering in the same confusing way.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

export NODE_ENV=production

echo "[build] node $(node --version), pnpm $(pnpm --version)"

install_dependencies() {
  # --prod=false: NODE_ENV=production is set above, but the build needs the
  # TypeScript toolchain from devDependencies.
  pnpm install --frozen-lockfile --prod=false
}

echo "[build] installing workspace dependencies"
install_dependencies

if ! node deploy/render/check-single-react.cjs; then
  echo "[build] stale node_modules detected, reinstalling from scratch"
  rm -rf node_modules \
         apps/web/node_modules apps/web/.next \
         services/api/node_modules \
         packages/contracts/node_modules
  install_dependencies
  node deploy/render/check-single-react.cjs
fi

echo "[build] building contracts"
pnpm --filter @cakeflow/contracts build

echo "[build] building the web app"
pnpm --filter @cakeflow/web build

echo "[build] done"
