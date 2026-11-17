#!/usr/bin/env bash
#
# Render start step for the CakeFlow API (native Node runtime, no Docker).
#
#  1. initialise an ephemeral MariaDB datadir in /tmp (first boot only)
#  2. start mariadbd on 127.0.0.1 and wait until it accepts connections
#  3. create the app + shadow databases
#  4. apply the committed migrations and seed the demo bakery
#  5. start the NestJS API in the foreground
#
# The datadir lives in /tmp, so every restart, redeploy or free-tier recycle can
# start from an empty database. Nothing here is meant for real bookings: there is
# no backup and no financial audit trail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MARIADB_HOME="${MARIADB_HOME:-$ROOT/deploy/render/vendor/mariadb}"
DATA_DIR="${MYSQL_DATA_DIR:-/tmp/cakeflow-mysql}"
SOCKET="${MYSQL_SOCKET:-$DATA_DIR/mysqld.sock}"
DB_PORT="${MYSQL_PORT:-3306}"

MARIADBD="$MARIADB_HOME/bin/mariadbd"
MARIADB="$MARIADB_HOME/bin/mariadb"
MARIADB_ADMIN="$MARIADB_HOME/bin/mariadb-admin"

if [ ! -x "$MARIADBD" ]; then
  echo "[start] MariaDB binaries not found at $MARIADB_HOME" >&2
  echo "[start] Run deploy/render/build-api.sh as the Render build command." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

if [ ! -d "$DATA_DIR/mysql" ]; then
  echo "[start] initialising ephemeral MariaDB datadir at $DATA_DIR"
  # Clear leftovers from an interrupted first boot so bootstrap starts clean.
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name 'init.log' -exec rm -rf {} +
  "$MARIADB_HOME/scripts/mariadb-install-db" \
    --no-defaults \
    --basedir="$MARIADB_HOME" \
    --datadir="$DATA_DIR" \
    --auth-root-authentication-method=normal \
    --skip-test-db \
    >"$DATA_DIR/init.log" 2>&1 || {
      echo "[start] mariadb-install-db failed:" >&2
      tail -n 100 "$DATA_DIR/init.log" >&2 || true
      exit 1
    }
fi

echo "[start] starting MariaDB on 127.0.0.1:$DB_PORT"
# Free Render instances have 512 MB RAM, so every cache is capped: the defaults
# (128 MB InnoDB pool, 128 MB key buffer, 128 MB Aria page cache) would not leave
# room for Node. This database holds a demo bakery, not a production workload.
"$MARIADBD" --no-defaults \
  --basedir="$MARIADB_HOME" \
  --datadir="$DATA_DIR" \
  --socket="$SOCKET" \
  --pid-file="$DATA_DIR/mysqld.pid" \
  --port="$DB_PORT" \
  --bind-address=127.0.0.1 \
  --lc-messages-dir="$MARIADB_HOME/share" \
  --plugin-dir="$MARIADB_HOME/lib/plugin" \
  --skip-name-resolve \
  --performance-schema=OFF \
  --innodb-buffer-pool-size=64M \
  --key-buffer-size=8M \
  --aria-pagecache-buffer-size=16M \
  --thread-cache-size=4 \
  --table-open-cache=128 \
  --table-definition-cache=256 \
  --max-connections=20 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci \
  --log-error="$DATA_DIR/error.log" &
DB_PID=$!

API_PID=""

cleanup() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill -TERM "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  echo "[start] stopping MariaDB"
  "$MARIADB_ADMIN" --no-defaults --socket="$SOCKET" -u root shutdown >/dev/null 2>&1 \
    || kill "$DB_PID" >/dev/null 2>&1 \
    || true
}
trap cleanup EXIT INT TERM

READY=0
for _ in $(seq 1 120); do
  if "$MARIADB_ADMIN" --no-defaults --socket="$SOCKET" -u root ping >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$DB_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$READY" != "1" ]; then
  echo "[start] MariaDB did not become ready" >&2
  tail -n 100 "$DATA_DIR/error.log" >&2 || true
  exit 1
fi

echo "[start] creating cakeflow databases"
"$MARIADB" --no-defaults --socket="$SOCKET" -u root <<'SQL'
CREATE DATABASE IF NOT EXISTS cakeflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS cakeflow_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'cakeflow'@'127.0.0.1' IDENTIFIED BY 'cakeflow';
CREATE USER IF NOT EXISTS 'cakeflow'@'localhost' IDENTIFIED BY 'cakeflow';
GRANT ALL PRIVILEGES ON cakeflow.* TO 'cakeflow'@'127.0.0.1';
GRANT ALL PRIVILEGES ON cakeflow.* TO 'cakeflow'@'localhost';
GRANT ALL PRIVILEGES ON cakeflow_shadow.* TO 'cakeflow'@'127.0.0.1';
GRANT ALL PRIVILEGES ON cakeflow_shadow.* TO 'cakeflow'@'localhost';
FLUSH PRIVILEGES;
SQL

export DATABASE_URL="${DATABASE_URL:-mysql://cakeflow:cakeflow@127.0.0.1:3306/cakeflow}"
export SHADOW_DATABASE_URL="${SHADOW_DATABASE_URL:-mysql://cakeflow:cakeflow@127.0.0.1:3306/cakeflow_shadow}"

cd "$ROOT/services/api"

echo "[start] applying migrations"
./node_modules/.bin/prisma migrate deploy

echo "[start] seeding demo data"
SEED_ALLOW_PRODUCTION=1 ./node_modules/.bin/tsx prisma/seed.ts

echo "[start] API listening on port ${PORT:-4000}"
node dist/main.js &
API_PID=$!
wait "$API_PID"
