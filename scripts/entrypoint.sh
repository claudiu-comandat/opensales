#!/bin/sh
# OpenSales API entrypoint.
# Auto-generates secrets on first boot and persists them to /app/data/secrets
# so subsequent restarts (Railway redeploys, docker restart, etc.) keep the same
# values. Then runs DB migrations and boots the API.
set -eu

SECRETS_DIR="${SECRETS_DIR:-/app/data/secrets}"
mkdir -p "$SECRETS_DIR"

# 64 hex chars; both keys are validated by env.schema.ts at app boot.
HEX64_RE='^[0-9a-fA-F]{64}$'

# If the var is set but doesn't match HEX64_RE, drop it so we regenerate.
# (Common pitfall on Railway: the dashboard's "Suggested Variables" panel
# pre-fills these from .env.example placeholders that don't pass validation.)
sanitize_hex64() {
  var_name="$1"
  current_value=$(printenv "$var_name" || true)
  if [ -n "$current_value" ] && ! echo "$current_value" | grep -Eq "$HEX64_RE"; then
    echo "[entrypoint] $var_name is set but not 64-hex; ignoring and regenerating."
    unset "$var_name"
  fi
}

generate_or_load() {
  var_name="$1"
  file_path="$SECRETS_DIR/$2"
  current_value=$(printenv "$var_name" || true)
  if [ -z "$current_value" ]; then
    if [ -f "$file_path" ]; then
      current_value=$(cat "$file_path")
      echo "[entrypoint] $var_name loaded from $file_path"
    else
      current_value=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
      echo "$current_value" > "$file_path"
      chmod 600 "$file_path"
      echo "[entrypoint] $var_name generated and saved to $file_path"
    fi
    export "$var_name=$current_value"
  fi
}

sanitize_hex64 PLATFORM_MASTER_KEY
sanitize_hex64 SESSION_SECRET

# Auto-generate platform secrets if not provided
generate_or_load PLATFORM_MASTER_KEY platform-master-key
generate_or_load SESSION_SECRET session-secret

# Sane defaults for ergonomics — override via Railway/compose env if you want
export PORT="${PORT:-3001}"
export NODE_ENV="${NODE_ENV:-production}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export PLUGINS_ROOT="${PLUGINS_ROOT:-/app/plugins}"
export PLATFORM_VERSION="${PLATFORM_VERSION:-0.1.0}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] FATAL: DATABASE_URL is not set." >&2
  echo "[entrypoint]   This script is the API entrypoint — it requires a Postgres connection." >&2
  echo "[entrypoint]   On Railway: open the API service → Variables → Raw Editor and set:" >&2
  echo "[entrypoint]     DATABASE_URL=\${{ Postgres.DATABASE_URL }}" >&2
  echo "[entrypoint]   If you are seeing this on the WEB service: go to that service →" >&2
  echo "[entrypoint]   Settings → Config File Path → set to apps/web/railway.toml" >&2
  echo "[entrypoint]   The web service does NOT need DATABASE_URL and should not run this script." >&2
  exit 1
fi

echo "[entrypoint] Running database migrations..."
node_modules/.bin/tsx packages/db/src/migrate.ts

# Optional: seed initial admin if BOTH env vars provided. Idempotent.
if [ -n "${INITIAL_ADMIN_EMAIL:-}" ] && [ -n "${INITIAL_ADMIN_PASSWORD:-}" ]; then
  echo "[entrypoint] Seeding initial admin (idempotent)..."
  node_modules/.bin/tsx packages/db/src/seed/admin.ts || echo "[entrypoint] admin seed exited non-zero (already present?), continuing"
fi

mkdir -p "$PLUGINS_ROOT"

# Seed plugins into DB (idempotent — skips any already present).
echo "[entrypoint] Seeding plugins (idempotent)..."
PLUGINS_ROOT="$PLUGINS_ROOT" node_modules/.bin/tsx packages/db/src/seed/plugins.ts \
  || echo "[entrypoint] plugin seed exited non-zero, continuing"

echo "[entrypoint] Starting API on :$PORT ..."
# Use @swc-node/register (SWC) instead of tsx (esbuild) for the API runtime —
# NestJS DI relies on emitDecoratorMetadata which esbuild does not emit.
# tsx is still used for migrate.ts / seed/admin.ts which don't use DI.
# Switch cwd to apps/api so Node resolves @swc-node/register from there.
cd /app/apps/api
export SWC_NODE_PROJECT=tsconfig.json
exec node --import @swc-node/register/esm-register src/main.ts
