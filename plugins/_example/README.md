# @opensales-plugin/example

Skeleton plugin pentru OpenSales. Folosește acest folder ca template pentru pluginurile noi.

## Structură

- `manifest.json` — declarația plugin-ului. Validată cu `@opensales/plugin-sdk`.
- `src/index.ts` — entry point. Trebuie să exporte default un `Plugin`.
- `data/` — storage privat (criptat). Creat automat la runtime; **NU commit-ui**.

## Convenții

1. **Numele package-ului** = `@opensales-plugin/<slug>`.
2. **Permissions** declarate în manifest sub array-ul `permissions`. Lista permisă în SDK.
3. **Capabilities** = ce face pluginul: `marketplace`, `shipping`, `invoicing`, `utility`.
4. **Build target**: ESM, Node 22, output în `dist/`.
5. **Secrets** se stochează prin `ctx.storage` (criptat AES-256-GCM via SDK).

## Cum creezi un plugin nou

```bash
cp -r plugins/_example plugins/<your-plugin>
# Editează manifest.json: name, displayName, capabilities, permissions
# Editează package.json: name
# Implementează src/index.ts
pnpm install  # rezolvă workspace dep
pnpm --filter @opensales-plugin/<your-plugin> test
```
