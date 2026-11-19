#!/usr/bin/env bash
#
# Render start step for the CakeFlow API (native Node runtime, no Docker).
#
#  1. create the SQLite database file in /tmp (fresh on every boot)
#  2. apply the committed migrations
#  3. seed the demo bakery
#  4. start the Express API in the foreground
#
# /tmp is ephemeral on Render, so every restart, redeploy or free-tier recycle
# starts from an empty database. Nothing here is meant for real bookings: there
# is no backup and no financial audit trail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# The API config validates NODE_ENV against development|test|production, so a
# dashboard value such as "Production" would abort the boot. Force the value
# the service is actually running as.
export NODE_ENV=production

DATA_DIR="${CAKEFLOW_DATA_DIR:-/tmp/cakeflow}"
mkdir -p "$DATA_DIR"

# Absolute `file:` URL: Prisma resolves relative paths against the schema
# directory, which would put the database inside the repo checkout.
export DATABASE_URL="${DATABASE_URL:-file:$DATA_DIR/cakeflow.db}"

cd "$ROOT/services/api"

echo "[start] database: $DATABASE_URL"
echo "[start] applying migrations"
./node_modules/.bin/prisma migrate deploy

echo "[start] seeding demo data"
SEED_ALLOW_PRODUCTION=1 ./node_modules/.bin/tsx prisma/seed.ts

echo "[start] API listening on port ${PORT:-4000}"
exec node dist/main.js
