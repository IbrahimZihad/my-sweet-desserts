#!/bin/sh
set -eu

# Apply committed migrations before the API accepts traffic.
# If no migrations exist yet (fresh checkout), generate one with:
#   pnpm --filter @cakeflow/api prisma:migrate --name init
pnpm prisma:deploy

exec node dist/main.js
