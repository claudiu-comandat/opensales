# ----- Base ---------------------------------------------------------------
FROM node:24-alpine AS base
ENV CI=1 \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:$PATH
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ----- Dependencies ------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @opensales/web...

# ----- Build (Next.js standalone output) ---------------------------------
FROM deps AS build
# NEXT_PUBLIC_* vars are baked into the JS bundle at build time.
# Railway passes service env vars as Docker build args automatically —
# we just need to declare ARG so Docker exposes them to the build layer.
COPY tsconfig.base.json tsconfig.json ./
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @opensales/web build

# ----- Production runner -------------------------------------------------
FROM node:24-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
RUN apk add --no-cache libc6-compat tini \
 && addgroup -S nextjs -g 1001 \
 && adduser -S nextjs -G nextjs -u 1001
WORKDIR /app

COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
