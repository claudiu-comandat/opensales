# @opensales-plugin/fgo

Conector pentru [FGO — Factură Generator Online](https://www.fgo.ro/).

## Capabilități

- Emitere factură (`emitInvoice`) — scrie în `orders.invoice`
- Anulare (`cancelInvoice`) — marchează `status='cancelled'`
- Stornare (`stornoInvoice`) — scrie în `orders.invoiceStorno`
- Status (`getInvoiceStatus`) — citire fără DB write
- PDF (`getInvoicePdf`) — base64
- Înregistrare încasare (`recordPayment`) — Premium/Enterprise FGO
- Nomenclatoare: țări, județe, TVA, valute, tipuri facturi, tipuri încasare

## Autentificare

FGO folosește două formule SHA-1 distincte:

- `/factura/emitere`: `SHA1(CodUnic + PrivateKey + Client.Denumire)`
- Toate celelalte: `SHA1(CodUnic + PrivateKey + Numar)` (sau `NumarFactura`, sau `CodUnic` la nomenclator)

Credențialele se stochează criptat în `/plugins/fgo/data/` prin `PluginSecretStorage`. Niciodată în DB-ul platformei sau în loguri.

## Mediu

Setează `environment` în secrets:

- `prod` → `https://www.fgo.ro/api/v1`
- `uat` → `https://uat.fgo.ro/api/v1`

## Rate limits FGO

Plugin-ul serializează toate request-urile printr-un token bucket pentru a respecta:

- Global: ~1 req/secundă
- `/articol/gestiune`: 1 req/5 sec (out-of-scope MVP)
- `/articol/articolemodificate`: 1 req/30 min (out-of-scope MVP)

Răspunsurile 429 sunt re-încercate cu backoff exponențial (max 3).

## Auto-emit pe order.created

Dacă `autoEmitOnOrderCreated=true` în secrets, plugin-ul ascultă evenimentul `order.created` și emite factura automat. Eșecurile NU blochează crearea order-ului — operatorul le poate retrimite manual din UI.

## Dev

```sh
pnpm -F @opensales-plugin/fgo build
pnpm -F @opensales-plugin/fgo test
pnpm -F @opensales-plugin/fgo typecheck
pnpm -F @opensales-plugin/fgo lint
```
