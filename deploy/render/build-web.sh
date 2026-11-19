#!/usr/bin/env bash
#
# Render build step for the single-process CakeFlow service
# (Next.js storefront + BFF + Express API on one port).
#
# Two things this script protects against:
#
#  1. NODE_ENV must be exactly "production" while `next build` runs. With
#     NODE_ENV=development Next loads its development React runtime and static
#     prerendering fails with "Cannot read properties of null (reading
#     'useContext')" and "<Html> should not be imported outside of
#     pages/_document". A non-standard dashboard value such as "Production"
#     also makes Next warn and use an inconsistent runtime. The web build
#     script pins the value itself; exporting it here covers the other steps.
#  2. node_modules must contain exactly one copy of React. Render caches
#     node_modules between builds, and a directory left over from a different
#     lockfile/package-manager version can keep a second React, which fails
#     prerendering in the same confusing way.
#
# The API is compiled with `tsc` into services/api/dist; apps/web/server.cjs
# requires it at runtime.
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

echo "[build] generating Prisma client"
# `generate` only needs the env var to be present; it never connects.
DATABASE_URL="${DATABASE_URL:-file:./build.db}" \
  pnpm --filter @cakeflow/api exec prisma generate

echo "[build] compiling the API"
pnpm --filter @cakeflow/api build

echo "[build] building the web app"
# `@cakeflow/web` build -> scripts/build.mjs, which pins NODE_ENV=production.
pnpm --filter @cakeflow/web build

test -f apps/web/.next/BUILD_ID || {
  echo "[build] next build finished without .next/BUILD_ID" >&2
  exit 1
}

echo "[build] done"
