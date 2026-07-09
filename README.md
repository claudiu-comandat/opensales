# OpenSales

Self-hosted e-commerce management platform.

![CI](https://github.com/comandat/ops-dev-2/actions/workflows/ci.yml/badge.svg)

> **One-click deploy:** see [`docs/railway-template.md`](./docs/railway-template.md) — publishes the repo as a Railway template that auto-creates Postgres + API + Web services with wired env vars and volumes.

## Ce face

OpenSales unifică:

- catalog de produse,
- listări pe marketplace-uri (eMAG, Trendyol, etc.),
- comenzi (cu AWB tur/retur și factură/storno integrate),
- sincronizări asincrone,
- un sistem de pluginuri TypeScript in-process pentru abstractizarea integrărilor.

## Quick start (sub 10 minute)

### Prereq

- Node `22.11.0` (`.nvmrc`)
- pnpm `>=9.12.0`
- Docker Desktop (pentru Postgres local)

### Setup

```bash
git clone https://github.com/comandat/ops-dev-2.git
cd ops-dev-2

# Versiunea Node
nvm use   # sau corepack enable

# Dependencies
pnpm install

# Postgres local
pnpm db:up

# Env
cp .env.example .env
# Generează cheie master:
echo "PLATFORM_MASTER_KEY=$(openssl rand -hex 32)" >> .env

# Migrare DB + seed admin
pnpm db:migrate
pnpm db:seed:admin

# Dev servers (în 2 terminale)
pnpm --filter @opensales/api dev   # http://localhost:3001
pnpm --filter @opensales/web dev   # http://localhost:3000
```

### Validare

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Toate trebuie să fie verzi.

## Self-host with Docker (n8n-style, one command)

Tot stack-ul (postgres + api + web) într-un singur compose. **Secrețe auto-generate la primul boot și persistate într-un volum** — nu trebuie să configurezi nimic.

```bash
git clone https://github.com/comandat/ops-dev-2.git
cd ops-dev-2
docker compose -f docker-compose.app.yml up -d --build
```

Asta e tot. După ~30 secunde:

- **Web (admin UI)**: http://localhost:3000
- **API**: http://localhost:3001
- **Swagger UI**: http://localhost:3001/api-docs
- **Login implicit**: `admin@opensales.local` / `admin12345` (ștergi din `docker-compose.app.yml` în prod)

Tot ce e persistent stă în 3 volume: `opensales-postgres` (DB), `opensales-data` (secrețele auto-generate `PLATFORM_MASTER_KEY` și `SESSION_SECRET`), `opensales-plugins` (folder-ele plugin-urilor instalate). `docker compose down` păstrează datele; `docker compose down -v` le șterge.

**Override variabile** prin `.env` la root (exemplu): `PUBLIC_API_URL`, `INITIAL_ADMIN_EMAIL`, `LOG_LEVEL`. Vezi `.env.example`.

## Deploy to Railway

**Best path — multi-service template (1 click, auto-creates Postgres + API + Web):**
Follow [`docs/railway-template.md`](./docs/railway-template.md). One-time setup (3 min) publishes the project as a Railway template; afterwards every deploy is a single button.

**Manual path — 1 service per repo deploy + add Postgres plugin:**
Repo-ul are `railway.toml` și `Dockerfile` la root → Railway le auto-detectează. **Singura configurare manuală necesară:** adăugarea plugin-ului PostgreSQL și opțional un Volume pentru `/app/data` (ca să persiste secretele între deploy-uri).

### API service

1. **railway.app** → New Project → **Deploy from GitHub repo** → alege `comandat/ops-dev-2`. Railway buildează `Dockerfile`-ul de la root.
2. **+ Add → Database → PostgreSQL.** Railway injectează automat `DATABASE_URL` în serviciul API (referință automată).
3. **Volume** (recomandat): Settings → Volumes → New Volume → mount path `/app/data`. Asta păstrează `PLATFORM_MASTER_KEY` și `SESSION_SECRET` între redeploys (entrypoint-ul le generează la primul boot și le scrie în `/app/data/secrets`).
4. **Variables** (opționale):
   - `WEB_URL` = URL-ul public al serviciului web (e.g. `https://${{web.RAILWAY_PUBLIC_DOMAIN}}`)
   - `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` — doar la prima rulare; șterge după ce te-ai logat.

Healthcheck `/healthz` și restart on-failure sunt deja în `railway.toml`. La fiecare deploy, entrypoint-ul:
- Generează / încarcă `PLATFORM_MASTER_KEY` și `SESSION_SECRET` din `/app/data/secrets`.
- Rulează migrațiile.
- Pornește API-ul pe `$PORT` (Railway injectează portul automat).

### Web service

1. În același Railway project, **+ Add → GitHub Repo → același repo**.
2. Settings → **Dockerfile Path** = `apps/web/Dockerfile`. Settings → **Watch Paths** = `apps/web/**` (build doar la modificări frontend).
3. **Variables**:
   - `NEXT_PUBLIC_API_URL` = `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` (referință la api service)
4. Settings → **Networking** → Generate Domain.

### Reverse-deploy din UI? Nu, nu e nevoie

Dacă vrei să adaugi tot ca template pentru "deploy with one click" complet, creează un Railway template din proiectul existent (Railway dashboard → Projects → ⋯ → Make template) și pune butonul în README:

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/<id>)
```

(Template-ul include automat servicii + Postgres + variabile referențiate.)

## Structura repo

```
apps/api          NestJS backend (TypeScript, Drizzle, pg-boss)
apps/web          Next.js 15 frontend (App Router, Tailwind, shadcn/ui)
packages/db       Drizzle schema + migrations + DB client
packages/plugin-sdk  SDK consumat de plugins
plugins/          Plugins instalate (1 folder per plugin)
docs/             Documentație
tasks/            Task definitions (development plans)
```

## Tech stack

- **Runtime**: Node.js 22.11.0
- **Backend**: NestJS, Drizzle ORM, Zod, pg-boss
- **Frontend**: Next.js 15, React 19, Tailwind, shadcn/ui
- **DB**: PostgreSQL 16
- **Test**: Vitest peste tot
- **Logging**: pino
- **Crypto**: argon2id pentru parole, AES-256-GCM pentru secrets de plugin

## Partea 2 features

Partea 2 a MVP-ului adaugă:

- **Auth** — sesiuni cookie `httpOnly` + CSRF token, roluri (`admin`, `operator`),
  API keys cu scope-uri pentru server-to-server.
- **Plugin engine** in-process cu Permission Gateway, events bus pub/sub,
  lifecycle complet (`installed -> pending_verification -> active -> error -> disabled`)
  și boot scanner care reîncarcă pluginurile la pornire.
- **Plugin SDK** (`@opensales/plugin-sdk`) cu `definePlugin`, `sdk.api`,
  `sdk.events`, `sdk.secrets`, `sdk.logger` — singura dependență obligatorie
  pentru autorii de plugin.
- **CLI** (`opensales plugin install/list/verify/remove`) cu suport pentru
  folder local, tarball, GitHub și npm.
- **OpenAPI auto-generat** — Swagger UI live la `/api-docs` și JSON la
  `/api-docs-json`.
- **Admin UI** — Next.js 15 cu pagini pentru login, products, orders,
  listings și management plugin (`/plugins`).

După login, vezi `/plugins` pentru a instala primul plugin. API-ul are
documentație live la `/api-docs`.

Detalii complete în [docs/partea-2/](./docs/partea-2/README.md):

- [Architecture overview](./docs/partea-2/README.md)
- [Plugin development guide](./docs/partea-2/plugin-development.md)
- [Permission catalog](./docs/partea-2/permission-catalog.md)
- [Event catalog](./docs/partea-2/event-catalog.md)
- [CLI reference](./docs/partea-2/cli.md)
- [API reference](./docs/partea-2/api-reference.md)

## Vezi și

- [docs/architecture.md](./docs/architecture.md) — decizii arhitecturale
- [docs/runbook.md](./docs/runbook.md) — operare zilnică
- [docs/plugin-development.md](./docs/plugin-development.md) — cum scrii un plugin
- [docs/partea-2/](./docs/partea-2/README.md) — documentația Partea 2
- [CONTRIBUTING.md](./CONTRIBUTING.md) — workflow git
- [CLAUDE.md](./CLAUDE.md) — ghid pentru AI assistants
- [tasks/partea-1/00_INDEX.md](./tasks/partea-1/00_INDEX.md) — task-urile de dezvoltare

## License

Privat. Toate drepturile rezervate.
