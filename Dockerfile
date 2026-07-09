#
# OpenSales API — root Dockerfile (auto-detected by Railway / Render / Fly.io).
# This is the SAME image as apps/api/Dockerfile but lives at repo root so
# zero-config deploys work out of the box.
#
# Why we ship source + tsx instead of compiled dist:
#   `@opensales/db` is a workspace package whose package.json exposes
#   `./src/index.ts` directly (not a compiled bundle). The api source imports
#   from it at runtime, so we need a runner that resolves TS at import-time.
#   tsx (Node loader on top of esbuild) does exactly that with sub-second
#   startup overhead.

# ----- Base ---------------------------------------------------------------
FROM node:24-alpine AS base
ENV CI=1 \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ----- Dependencies (cached on lockfile) ---------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY plugins/emag/package.json ./plugins/emag/
COPY plugins/fgo/package.json ./plugins/fgo/
COPY plugins/olx/package.json ./plugins/olx/
COPY plugins/skroutz/package.json ./plugins/skroutz/
COPY plugins/smartbill/package.json ./plugins/smartbill/
COPY plugins/temu/package.json ./plugins/temu/
COPY plugins/trendyol/package.json ./plugins/trendyol/
RUN pnpm install --frozen-lockfile \
    --filter @opensales/api... \
    --filter @opensales-plugin/emag \
    --filter @opensales-plugin/fgo \
    --filter @opensales-plugin/olx \
    --filter @opensales-plugin/skroutz \
    --filter @opensales-plugin/smartbill \
    --filter @opensales-plugin/temu \
    --filter @opensales-plugin/trendyol

# ----- Plugin builder (TypeScript → dist/) --------------------------------
FROM base AS plugin-builder
# Root node_modules: .pnpm virtual store + root-level workspace symlinks
COPY --from=deps /app/node_modules ./node_modules
# Per-package node_modules: pnpm puts each package's direct deps here
# (pnpm does NOT hoist to root by default — symlinks live per-package)
COPY --from=deps /app/packages/plugin-sdk/node_modules ./packages/plugin-sdk/node_modules
COPY --from=deps /app/plugins/emag/node_modules ./plugins/emag/node_modules
COPY --from=deps /app/plugins/fgo/node_modules ./plugins/fgo/node_modules
COPY --from=deps /app/plugins/olx/node_modules ./plugins/olx/node_modules
COPY --from=deps /app/plugins/skroutz/node_modules ./plugins/skroutz/node_modules
COPY --from=deps /app/plugins/smartbill/node_modules ./plugins/smartbill/node_modules
COPY --from=deps /app/plugins/temu/node_modules ./plugins/temu/node_modules
COPY --from=deps /app/plugins/trendyol/node_modules ./plugins/trendyol/node_modules
# plugin-sdk source (node_modules/@opensales/plugin-sdk symlinks here)
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY packages/plugin-sdk/src ./packages/plugin-sdk/src
# Root tsconfig extended by all plugins
COPY tsconfig.base.json ./tsconfig.base.json
# Plugin sources
COPY plugins/emag ./plugins/emag
COPY plugins/fgo ./plugins/fgo
COPY plugins/olx ./plugins/olx
COPY plugins/skroutz ./plugins/skroutz
COPY plugins/smartbill ./plugins/smartbill
COPY plugins/temu ./plugins/temu
COPY plugins/trendyol ./plugins/trendyol
# Compile TypeScript → dist/ for each plugin (in parallel)
RUN node_modules/.bin/tsc -p plugins/emag/tsconfig.json & \
    node_modules/.bin/tsc -p plugins/fgo/tsconfig.json & \
    node_modules/.bin/tsc -p plugins/olx/tsconfig.json & \
    node_modules/.bin/tsc -p plugins/skroutz/tsconfig.json & \
    node_modules/.bin/tsc -p plugins/smartbill/tsconfig.json & \
    node_modules/.bin/tsc -p plugins/temu/tsconfig.json & \
    node_modules/.bin/tsc -p plugins/trendyol/tsconfig.json & \
    wait

# ----- Production runner -------------------------------------------------
FROM node:24-alpine AS runner
ENV NODE_ENV=production \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH
# poppler-utils → `pdftotext`, folosit de backfill-ul one-time al facturilor Trendyol
# (extrage seria+numărul din textul PDF FGO). ~4 MB; se poate scoate după rulare.
RUN apk add --no-cache libc6-compat tini bash poppler-utils \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Lockfile + workspace declarations
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Installed deps
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/plugin-sdk/node_modules ./packages/plugin-sdk/node_modules

# Source (we run via tsx, not compiled dist — see header)
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src

COPY packages/db/package.json ./packages/db/package.json
COPY packages/db/tsconfig.json ./packages/db/tsconfig.json
COPY packages/db/src ./packages/db/src
COPY packages/db/migrations ./packages/db/migrations
COPY packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts

COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY packages/plugin-sdk/tsconfig.json ./packages/plugin-sdk/tsconfig.json
COPY packages/plugin-sdk/src ./packages/plugin-sdk/src

COPY tsconfig.base.json ./tsconfig.base.json
COPY tsconfig.json ./tsconfig.json

# Plugins — compiled dist/ + manifest + package.json + node_modules
# node_modules must be present at runtime: pnpm stores zod/sdk symlinks
# per-package; Node ESM resolution walks up from dist/ and needs them.
COPY --from=deps /app/plugins/emag/node_modules ./plugins/emag/node_modules
COPY --from=deps /app/plugins/fgo/node_modules ./plugins/fgo/node_modules
COPY --from=deps /app/plugins/olx/node_modules ./plugins/olx/node_modules
COPY --from=deps /app/plugins/skroutz/node_modules ./plugins/skroutz/node_modules
COPY --from=deps /app/plugins/smartbill/node_modules ./plugins/smartbill/node_modules
COPY --from=deps /app/plugins/temu/node_modules ./plugins/temu/node_modules
COPY --from=deps /app/plugins/trendyol/node_modules ./plugins/trendyol/node_modules
COPY --from=plugin-builder /app/plugins/emag/dist ./plugins/emag/dist
COPY --from=plugin-builder /app/plugins/emag/logo.svg ./plugins/emag/logo.svg
COPY --from=plugin-builder /app/plugins/emag/manifest.json ./plugins/emag/manifest.json
COPY --from=plugin-builder /app/plugins/emag/package.json ./plugins/emag/package.json
COPY --from=plugin-builder /app/plugins/fgo/dist ./plugins/fgo/dist
COPY --from=plugin-builder /app/plugins/fgo/manifest.json ./plugins/fgo/manifest.json
COPY --from=plugin-builder /app/plugins/fgo/package.json ./plugins/fgo/package.json
COPY --from=plugin-builder /app/plugins/olx/dist ./plugins/olx/dist
COPY --from=plugin-builder /app/plugins/olx/logo.svg ./plugins/olx/logo.svg
COPY --from=plugin-builder /app/plugins/olx/manifest.json ./plugins/olx/manifest.json
COPY --from=plugin-builder /app/plugins/olx/package.json ./plugins/olx/package.json
COPY --from=plugin-builder /app/plugins/skroutz/dist ./plugins/skroutz/dist
COPY --from=plugin-builder /app/plugins/skroutz/logo.svg ./plugins/skroutz/logo.svg
COPY --from=plugin-builder /app/plugins/skroutz/manifest.json ./plugins/skroutz/manifest.json
COPY --from=plugin-builder /app/plugins/skroutz/package.json ./plugins/skroutz/package.json
COPY --from=plugin-builder /app/plugins/smartbill/dist ./plugins/smartbill/dist
COPY --from=plugin-builder /app/plugins/smartbill/logo.svg ./plugins/smartbill/logo.svg
COPY --from=plugin-builder /app/plugins/smartbill/manifest.json ./plugins/smartbill/manifest.json
COPY --from=plugin-builder /app/plugins/smartbill/package.json ./plugins/smartbill/package.json
COPY --from=plugin-builder /app/plugins/temu/dist ./plugins/temu/dist
COPY --from=plugin-builder /app/plugins/temu/logo.svg ./plugins/temu/logo.svg
COPY --from=plugin-builder /app/plugins/temu/manifest.json ./plugins/temu/manifest.json
COPY --from=plugin-builder /app/plugins/temu/package.json ./plugins/temu/package.json
COPY --from=plugin-builder /app/plugins/trendyol/dist ./plugins/trendyol/dist
COPY --from=plugin-builder /app/plugins/trendyol/logo.svg ./plugins/trendyol/logo.svg
COPY --from=plugin-builder /app/plugins/trendyol/manifest.json ./plugins/trendyol/manifest.json
COPY --from=plugin-builder /app/plugins/trendyol/package.json ./plugins/trendyol/package.json

# Resolve pnpm store symlinks → real directories so Node ESM resolution works.
# pnpm creates absolute symlinks (e.g. node_modules/zod -> /app/node_modules/.pnpm/...)
# that are valid inside the deps stage but can break in multi-stage builds when
# the .pnpm store path differs or the layer is inspected without context.
# This loop replaces each top-level symlink in plugin node_modules with a real copy.
RUN for nm in plugins/emag/node_modules plugins/fgo/node_modules plugins/olx/node_modules plugins/skroutz/node_modules plugins/smartbill/node_modules plugins/temu/node_modules plugins/trendyol/node_modules; do \
    [ -d "$nm" ] || continue; \
    for lnk in "$nm"/*; do \
      [ -L "$lnk" ] || continue; \
      tgt=$(readlink -f "$lnk" 2>/dev/null) || continue; \
      [ -e "$tgt" ] || continue; \
      rm "$lnk" && cp -r "$tgt" "$lnk"; \
    done; \
  done

# Entrypoint: auto-generate secrets, migrate, run
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/data/secrets

ENV PORT=3001 \
    PLATFORM_VERSION=0.1.0 \
    PLUGINS_ROOT=/app/plugins \
    SECRETS_DIR=/app/data/secrets \
    NODE_OPTIONS=--max-old-space-size=1536
EXPOSE 3001

# tini reaps zombies and forwards SIGTERM cleanly so Railway can restart fast.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
