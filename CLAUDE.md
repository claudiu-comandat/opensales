# CLAUDE.md — Ghid pentru AI Assistants

Acest fișier e citit automat de Claude Code și alte AI assistants când lucrează în acest repo.

## Reguli generale

1. **TypeScript strict.** Niciun `any`, niciun cast la `any`. Pentru `unknown` validează cu Zod.
2. **TDD-first.** Niciun task nu e "done" fără teste verzi.
3. **Vitest peste tot** — niciodată Jest.
4. **pnpm only** — niciodată npm sau yarn.
5. **Conventional Commits**: `feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`, `perf:`, `ci:`, `build:`.
6. **Hard deletes only** pentru MVP. Niciun soft delete.
7. **UUID v7** generat în aplicație cu `uuid` package. NU `gen_random_uuid()`.
8. **Multi-currency** stocat ca `amount_minor bigint` + `currency char(3)`. NICIODATĂ float pentru bani.
9. **Niciun `console.log`** în cod de producție. Folosește `Logger` din nestjs-pino.
10. **Niciun secret în DB-ul platformei.** Plugin-urile își gestionează propriile credențiale în `/plugins/<x>/data/` (criptate).

## Cum lucrezi pe un task

1. **RED**: scrie testele întâi. Confirmă că eșuează.
2. **GREEN**: implementează minimum pentru ca testele să treacă.
3. **REFACTOR**: cleanup. Testele rămân verzi.
4. Rulează validările (lint, typecheck, test, build).
5. Commit direct pe `main` cu mesaj Conventional Commits.

## Permission model pentru plugins

Pluginurile NU pot accesa direct DB-ul platformei. Comunică prin `PluginContext.api` care trece prin **Permission Gateway** (validează `plugins.granted_permissions` contra request-ului).

## Ce NU faci

- NU folosești `--no-verify` la commit (skip hooks).
- NU comiți `.env`, secrete, sau orice în `plugins/*/data/`.
- NU adăugi feature flags doar de dragul "decuplării" — keep code direct.
- NU adăugi comentarii care doar repetă codul.

## Convenții fișiere

- Imports: alfabetic, grupate (extern → intern → relativ).
- File names: `kebab-case.ts`. Test files: `*.test.ts` lângă fișierul testat.
- Tipuri: nume PascalCase, exportate explicit.
- Funcții pure preferate față de clase, EXCEPT NestJS providers (acolo clase cu decoratori).

## Resurse

- [docs/architecture.md](./docs/architecture.md) — decizii arhitecturale
