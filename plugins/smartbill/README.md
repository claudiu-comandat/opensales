# @opensales-plugin/smartbill

Conector pentru [SmartBill Cloud](https://www.smartbill.ro/) — facturare prin API-ul REST `https://ws.smartbill.ro/SBORO/api`.

## Capabilități

- Emitere factură (`emitInvoice`) — scrie în `orders.invoice`
- Anulare (`cancelInvoice`) — `PUT /invoice/cancel`, marchează `status='cancelled'` (păstrează documentul)
- Ștergere directă (`smartbillDeleteDirect`) — `DELETE /invoice` (doar ultima din serie), fără DB write; folosit la cascade delete
- Stornare (`stornoInvoice`) — `POST /invoice/reverse`, scrie în `orders.invoiceStorno`
- Restaurare (`restoreInvoice`) — `PUT /invoice/restore`, readuce `status='issued'`
- Stare încasare (`getInvoicePaymentStatus`) — `GET /invoice/paymentstatus`, citire fără DB write
- PDF (`getInvoicePdf`) — `GET /invoice/pdf` (octet-stream → base64)
- Înregistrare încasare (`recordPayment`) — `POST /payment`
- Nomenclatoare: cote TVA (`listVatRates` → `GET /tax`), serii documente (`listSeries` → `GET /series`)

## Autentificare

SmartBill folosește HTTP Basic preemptiv: `Authorization: Basic base64(email:token)`.

- `username` = adresa de email a contului SmartBill Cloud
- `token` = token-ul API din **Contul Meu > Integrări > API**
- `companyVatCode` (CIF, ex. `RO12345678`) este trimis pe fiecare apel autentificat (body sau query)

Credențialele se stochează criptat în `/plugins/smartbill/data/` prin `PluginSecretStorage`. Niciodată în DB-ul platformei sau în loguri.

## Mediu

SmartBill nu expune un host de sandbox separat — toate apelurile merg către producție (`https://ws.smartbill.ro/SBORO/api`). Testarea se face cu un cont real și o serie dedicată.

## Răspunsuri și erori

Răspunsurile JSON sunt obiecte flat la top-level. Un `errorText` nevid înseamnă eroare **chiar și pe HTTP 200** — plugin-ul mapează acest caz la `SmartBillApiError`. HTTP 4xx/5xx sunt de asemenea erori.

## Rate limits SmartBill

Limită: **30 apeluri / 10 secunde**; depășirea → blocare 10 minute (HTTP 403). Plugin-ul serializează toate request-urile printr-un token bucket (3 req/sec implicit) și re-încearcă pe 403 cu backoff exponențial (max 3), respectând header-ul `X-RateLimit-Reset` când e prezent.

## Serii și cote TVA

`seriesName` (seria de facturi) și combinația `taxName`+`taxPercentage` trebuie să existe deja create în contul SmartBill Cloud — API-ul nu le creează automat. Plugin-ul preferă seria de pe order (`marketplaceInvoiceSeries`) peste `defaultSeriesName` din secrets.

## Auto-emit pe order.created

Dacă `autoEmitOnOrderCreated=true` în secrets, plugin-ul ascultă `order.created` și emite factura automat. Implicit **dezactivat**. Eșecurile NU blochează crearea order-ului — operatorul le poate retrimite manual.

## Domenii amânate (în afara MVP)

Proforme (`/estimate/*`), bonuri fiscale, trimitere documente prin e-mail (`/document/send`), interogare stoc (`/stocks`) — nu sunt necesare pentru fluxul order → factură și nu au capabilitate dedicată în catalogul OpenSales.

## Dev

```sh
pnpm -F @opensales-plugin/smartbill build
pnpm -F @opensales-plugin/smartbill test
pnpm -F @opensales-plugin/smartbill typecheck
pnpm -F @opensales-plugin/smartbill lint
```
