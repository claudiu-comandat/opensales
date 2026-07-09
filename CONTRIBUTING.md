# Contributing

## Workflow git

1. Branch nou: `git checkout -b feat/T1.XX-titlu`.
2. Commit-uri Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`.
3. Push + PR pe `main`.
4. CI trebuie să fie verde.
5. Squash & merge.

## Pre-commit hooks

- ESLint + Prettier rulat pe staged files via lint-staged.
- Commitlint validează mesajul.
- Hook-urile sunt instalate automat la `pnpm install` via Husky.

## Cum rulezi local

Vezi [README.md](./README.md) — Quick start.

## Cum adaugi o tabelă în DB

1. Editează `packages/db/src/schema/<table>.ts`.
2. Adaugă export în `packages/db/src/schema/index.ts`.
3. Generează migrația: `pnpm --filter @opensales/db db:generate`.
4. Verifică SQL-ul în `packages/db/migrations/`.
5. Aplică: `pnpm --filter @opensales/db db:migrate`.
6. Scrie teste de schemă în `<table>.test.ts`.

## Cum adaugi un plugin

Vezi [docs/plugin-development.md](./docs/plugin-development.md).

## Cum adaugi o componentă shadcn/ui

```bash
cd apps/web
pnpm dlx shadcn@latest add <component>
```

## Issues & PRs

- Folosește template-uri GitHub.
- Referențiază task ID-ul în titlu (ex: `feat(T1.14): users schema`).
