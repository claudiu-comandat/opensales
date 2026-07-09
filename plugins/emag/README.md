# @opensales-plugin/emag

Conector pentru **eMAG Marketplace API v4.5.1** (RO / BG / HU + FashionDays RO/BG).

## Capabilități acoperite (în plan de rulare)

| Wave | Domeniu | Endpoint-uri eMAG |
|------|---------|-------------------|
| 0 (foundation, **DONE**) | Auth, rate limit, error mapping | — |
| 1 | Comenzi | `order/read`, `order/save`, `order/count`, `order/acknowledge/{id}`, `order/{id}/unlock-courier`, `order/attachments/{read,save}`, `order/volumetry/read` |
| 2 | Produse & oferte | `product_offer/{read,save,count}`, `offer/save` (light), `offer_stock/{id}` PATCH, `documentation/find_by_eans`, `measurements/save` |
| 3 | AWB | `awb/{read,save}`, `awb/read_pdf/{id}`, `awb/package/{read,save}`, `courier_accounts/read`, `addresses/read`, `locality/{read,count}` |
| 4 | RMA + Campanii | `rma/{read,save,count}`, `campaign_proposals/save` |
| 5 | Lookups | `category/{read,count}`, `vat/read`, `handling_time/read`, `invoice/{categories,...}`, `customer-invoice/...`, `smart-deals-price-check` |

## Configurare

Plugin-ul citește credențiale dintr-un singur secret blob (criptat cu master key-ul platformei):

```ts
{
  platform: 'emag-ro' | 'emag-bg' | 'emag-hu' | 'fd-ro' | 'fd-bg',
  username: '<eMAG API user>',
  password: '<eMAG API password>',
  callbackUrl?: '<URL public spre care eMAG trimite notificări>'
}
```

În UI-ul OpenSales: **Plugins → eMAG Marketplace → Configurează** completează formularul. Secretele sunt scrise prin `ctx.secrets.set(...)` în `data/<plugin>/`.

## Autentificare API

eMAG folosește HTTP Basic Auth: `Authorization: Basic base64(username:password)`. Userul trebuie să aibă API rights activate în contul de marketplace.

## Rate limiting

Cumulativ pe TOATE endpoint-urile (per cont):
- **5 requests/second**
- **200 requests/minute**

Clientul (`src/client.ts`) implementează un token bucket dual care serializează cererile când ar depăși orice limită. La 429 face exponential backoff cu retry până la 3 ori. Dacă headerul `Retry-After` e prezent, îl respectă.

## Format răspuns

Toate endpoint-urile returnează JSON:

```json
{ "isError": false, "messages": [], "results": <T> }
```

Clientul aruncă `EmagApiError` dacă `isError === true` SAU HTTP ≥ 400. Subclasă `EmagRateLimitError` la 429.

## Dezvoltare locală

```bash
pnpm --filter @opensales-plugin/emag test
pnpm --filter @opensales-plugin/emag typecheck
pnpm --filter @opensales-plugin/emag lint
pnpm --filter @opensales-plugin/emag build
```

## Documentație eMAG

Documentul oficial v4.5.1 (1555 linii, indexat în context-mode): `C:/Users/titam/Desktop/plugins/emag/emag_docu.md`. Search prin `mcp__context-mode__ctx_search` cu `source: "emag-api-docs"`.
