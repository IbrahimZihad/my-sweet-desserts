#!/usr/bin/env bash
#
# Render build step for the CakeFlow API (native Node runtime, no Docker).
#
# There is no database server to install: the API uses SQLite, which is compiled
# into the Node process. The database file itself is created by start-api.sh in
# /tmp on every boot, so nothing database-related is produced here.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "[build] installing workspace dependencies"
# --prod=false: NODE_ENV=production is set on the service, but the build needs
# the prisma CLI, tsx and the TypeScript toolchain from devDependencies.
pnpm install --frozen-lockfile --prod=false

echo "[build] building contracts"
pnpm --filter @cakeflow/contracts build

echo "[build] generating Prisma client"
# `generate` only needs the env var to be present; it never connects.
DATABASE_URL="${DATABASE_URL:-file:./build.db}" \
  pnpm --filter @cakeflow/api exec prisma generate

echo "[build] compiling the API"
pnpm --filter @cakeflow/api build

echo "[build] done"
