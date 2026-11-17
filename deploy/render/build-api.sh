#!/usr/bin/env bash
#
# Render build step for the CakeFlow API (native Node runtime, no Docker).
#
# Render's native runtime cannot apt-get install a database server, so this
# script downloads a portable MariaDB build and keeps only the handful of files
# needed to initialise and run an ephemeral server at boot. The binaries are
# stripped and their shared-library dependencies are checked here, at build
# time, so a broken deploy fails with a readable log instead of a crash loop.
#
# Everything this script produces is throwaway build output: the database itself
# is created in /tmp by start-api.sh on every boot.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

MARIADB_VERSION="${MARIADB_VERSION:-10.11.10}"
ARCHIVE="mariadb-${MARIADB_VERSION}-linux-systemd-x86_64"
URL="https://archive.mariadb.org/mariadb-${MARIADB_VERSION}/bintar-linux-systemd-x86_64/${ARCHIVE}.tar.gz"

VENDOR_DIR="deploy/render/vendor"
MARIADB_HOME="$VENDOR_DIR/mariadb"
TARBALL="$VENDOR_DIR/mariadb.tar.gz"

# ---------------------------------------------------------------------------
# 1. Portable MariaDB
# ---------------------------------------------------------------------------
download() {
  # Render's native image always ships Node; curl/wget are usually but not
  # guaranteed to be present.
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --retry-delay 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 --timeout=60 -O "$2" "$1"
  else
    node -e '
      const https = require("https");
      const fs = require("fs");
      const get = (url, out, hops) => {
        https.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
            res.resume();
            return get(res.headers.location, out, hops - 1);
          }
          if (res.statusCode !== 200) {
            console.error("HTTP " + res.statusCode + " for " + url);
            process.exit(1);
          }
          res.pipe(fs.createWriteStream(out)).on("finish", () => process.exit(0));
        }).on("error", (err) => {
          console.error(err.message);
          process.exit(1);
        });
      };
      get(process.argv[1], process.argv[2], 5);
    ' "$1" "$2"
  fi
}

if [ ! -x "$MARIADB_HOME/bin/mariadbd" ]; then
  echo "[build] downloading MariaDB ${MARIADB_VERSION} (portable build)"
  mkdir -p "$MARIADB_HOME"
  download "$URL" "$TARBALL"

  echo "[build] extracting server, client and bootstrap files"
  # Only these members are needed: the daemon, the admin/client tools used by
  # start-api.sh, the install script, error messages, charsets and the SQL that
  # seeds the system tables during bootstrap.
  tar -xzf "$TARBALL" -C "$MARIADB_HOME" --strip-components=1 --wildcards \
    "$ARCHIVE/bin/mariadbd" \
    "$ARCHIVE/bin/mariadb" \
    "$ARCHIVE/bin/mariadb-admin" \
    "$ARCHIVE/bin/my_print_defaults" \
    "$ARCHIVE/bin/resolveip" \
    "$ARCHIVE/scripts/mariadb-install-db" \
    "$ARCHIVE/share/*.sql" \
    "$ARCHIVE/share/english/*" \
    "$ARCHIVE/share/charsets/*"

  rm -f "$TARBALL"
  # mariadbd is happy with an empty plugin directory; the storage engines and
  # auth plugins we use are compiled in.
  mkdir -p "$MARIADB_HOME/lib/plugin"
fi

# The upstream tarball ships unstripped binaries (~300 MB for mariadbd alone,
# almost all of it DWARF debug info). Stripping keeps the build well inside the
# instance disk quota. If binutils is unavailable we still run, just larger.
if command -v strip >/dev/null 2>&1; then
  for bin in mariadbd mariadb mariadb-admin my_print_defaults resolveip; do
    strip --strip-unneeded "$MARIADB_HOME/bin/$bin" 2>/dev/null || true
  done
fi

echo "[build] checking MariaDB shared-library dependencies"
LDD_LOG="$(mktemp)"
ldd "$MARIADB_HOME/bin/mariadbd" >"$LDD_LOG" 2>&1 || true
cat "$LDD_LOG"
if grep -q "not found" "$LDD_LOG"; then
  echo "[build] ERROR: mariadbd needs shared libraries that are missing from this image:" >&2
  grep "not found" "$LDD_LOG" >&2
  echo "[build] Provide them (buildpacks cannot apt-get) or switch the demo to a managed MySQL." >&2
  rm -f "$LDD_LOG"
  exit 1
fi
rm -f "$LDD_LOG"

# Actually load the binaries in the same environment the start command will use.
# This catches missing shared libraries, wrong CPU architecture and a broken
# bootstrap script before the service ever goes live.
echo "[build] smoke-testing the MariaDB binaries"
"$MARIADB_HOME/bin/mariadbd" --version
"$MARIADB_HOME/bin/mariadb" --version
sh -n "$MARIADB_HOME/scripts/mariadb-install-db"

echo "[build] MariaDB ready at $MARIADB_HOME ($(du -sh "$MARIADB_HOME" | cut -f1))"

# ---------------------------------------------------------------------------
# 2. Application
# ---------------------------------------------------------------------------
echo "[build] installing workspace dependencies"
corepack enable
corepack prepare pnpm@9.12.0 --activate
# --prod=false: NODE_ENV=production is set on the service, but the build needs
# the prisma CLI, tsx and the TypeScript toolchain from devDependencies.
pnpm install --frozen-lockfile --prod=false

echo "[build] building contracts"
pnpm --filter @cakeflow/contracts build

echo "[build] generating Prisma client"
DATABASE_URL="${BUILD_DATABASE_URL:-mysql://cakeflow:cakeflow@127.0.0.1:3306/cakeflow}" \
SHADOW_DATABASE_URL="${BUILD_SHADOW_DATABASE_URL:-mysql://cakeflow:cakeflow@127.0.0.1:3306/cakeflow_shadow}" \
  pnpm --filter @cakeflow/api exec prisma generate

echo "[build] compiling the API"
pnpm --filter @cakeflow/api build

echo "[build] done"
