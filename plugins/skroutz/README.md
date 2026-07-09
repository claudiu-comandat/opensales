# @opensales-plugin/skroutz

Conector OpenSales pentru **Skroutz Marketplace (Smart Cart)** — marketplace din Grecia.

## Strategie de integrare

100% API-based (REST/JSON) plus generare de **XML Feed** pentru postarea catalogului.
Base URL: `https://api.skroutz.gr`. Header obligatoriu pe toate apelurile:
`Accept: application/vnd.skroutz+json; version=3.0`.

Skroutz folosește **două token-uri Bearer** separate, generate din pagini diferite
ale panoului de Merchant:

- `ordersToken` — Orders API (Merchants > Services > Skroutz Marketplace)
- `productsToken` — Products API (Merchants > Products > Feed Updates)

Ambele se stochează criptat în `plugins/skroutz/data/` prin `PluginContext.secrets`.

## Capabilități → cerințe

| Cerință | Acțiune(i) | Mecanism Skroutz |
| --- | --- | --- |
| 1. Postare produse | `generateProductFeed` | XML Feed (singura cale de creare produse). `validateInventory` pentru dry-run. |
| 2. Primire comenzi | `getOrder`, `parseWebhook`, `acceptOrder`, `rejectOrder`, `uploadInvoice`, `setAsReady`, `setAsNotReady`, `updateTrackingDetails` | Orders API + Webhook |
| 3. Update stock | `updateInventory` (`quantity`) | Products API `POST /merchants/products/batch` |
| 4. Update preț | `updateInventory` (`price`, în cenți) | Products API batch |
| 5. Activare/inactivare ofertă | `setOfferActive` (`enabled`), `updateInventory` | Products API batch |

### Note importante

- **Products API nu creează produse noi.** Crearea/publicarea catalogului se face
  exclusiv prin **XML Feed** — de aceea „postarea produselor” înseamnă generarea
  feed-ului XML (`generateProductFeed`), pe care merchant-ul îl servește către
  SkroutzBot.
- Prețurile din Products API sunt **integer în cenți** (ex. `2999` = €29.99),
  identic cu reprezentarea `amount_minor` din OpenSales. Moneda este întotdeauna
  `EUR`.
- Webhook-urile Skroutz **nu sunt semnate**; verificarea opțională se face printr-un
  `webhookSecret` partajat (în URL/header), comparat de `parseWebhook`.

## Comenzi

```bash
pnpm --filter @opensales-plugin/skroutz test
pnpm --filter @opensales-plugin/skroutz typecheck
pnpm --filter @opensales-plugin/skroutz lint
pnpm --filter @opensales-plugin/skroutz build
```
