# API — Prelistare eMAG (`POST /import/products/prelist`)

Postează produse noi pe **eMAG România** cu date minime — **fără categorie și caracteristici** —
înainte ca marfa să ajungă fizic în depozit. eMAG atribuie automat categoria și caracteristicile
minime în procesul de validare; după aprobare, OpenSales le extrage în listing și notifică
(opțional) procesul extern de completare.

Endpoint-ul coexistă cu `POST /import/products` — fluxul standard rămâne neschimbat.

---

## De ce

Fluxul standard cere categorie + caracteristici corecte din prima, iar majoritatea erorilor de
validare eMAG vin din categoria greșită. Prelistarea inversează procesul: lași eMAG să aleagă
categoria, apoi completezi caracteristicile rămase pe structura deja validată. Produsele sunt
astfel validate și gata de vânzare înainte ca stocul să existe fizic.

---

## Autentificare

Ca la `/import/products`: API key (`Authorization: Bearer`) sau sesiune browser.
Rol `admin`/`operator`, scope `products:write`.

---

## Request

```
POST /import/products/prelist
Content-Type: application/json
```

```json
{
  "products": [
    {
      "sku": "TRICOU-ALB-M",
      "title": "Tricou alb mărimea M",
      "brand": "Nike",
      "description": "Tricou 100% bumbac.",
      "price": 9999,
      "images": [{ "url": "https://cdn.example.com/tricou.jpg" }],
      "ean": "5901234123457"
    }
  ]
}
```

### Câmpuri (per produs)

| Câmp | Tip | Obligatoriu | Descriere |
|------|-----|:-----------:|-----------|
| `sku` | string (max 64) | ✅ | Identificator intern. **Trebuie să fie nou** — SKU existent e respins |
| `title` | string (max 255) | ✅ | Titlul produsului |
| `brand` | string (max 255) | ✅ | Brandul (obligatoriu pe eMAG) |
| `price` | integer | ✅ | Preț de vânzare în **minor units** (9999 = 99.99 RON) |
| `images` | `Image[]` (min 1) | ✅ | Imaginile produsului |
| `ean` | string (max 64) | ✅ | Cod EAN — folosit de eMAG la matching/asociere |
| `description` | string (max 30 000) | — | Descrierea produsului |
| `currency` | string (ISO 4217) | — | Default `"RON"` |
| `vatRate` | integer 0-100 | — | Default `0` |
| `handlingTime` | integer ≥ 0 | — | Zile de procesare |

**Ce NU trimiți** (derivat automat, identic cu `/import/products`): `stock` (forțat 0),
`stockCode` (alocat automat, devine `id`-ul eMAG), `fullPrice` (price × 1.75), dimensiuni/greutate
(defaults), `vat_id`, `part_number` (= sku). **Ce lipsește intenționat din payload-ul eMAG:**
`category_id` și `characteristics`.

---

## Răspuns

Identic cu `/import/products`: sincron `{batchId, status, results}` per SKU, procesare asincronă.
Progres: `GET /import/products/{batchId}`.

Un SKU **deja existent** → `status: "rejected"`, reason
`"SKU deja existent — prelistarea e doar pentru produse noi"` (prelistarea nu atinge produse
existente — ar seta stocul la 0).

---

## Ciclul de viață al listing-ului prelist

```
draft ──push (fără categorie, stock 0)──▶ pending_approval
                                              │
                    eMAG validează + atribuie categorie/caracteristici
                                              │
                             ┌────────────────┴────────────────┐
                          rejected                          active
                     (reguli automate de                       │
                      corecție: brand/imagini;      reconcile extrage în syncState:
                      restul manual + repush)         category, characteristics,
                                                      part_number_key,
                                                      prelist_validated_at
                                                              │
                                                 POST → webhook-ul de prelistare
                                                  (configurat în Setări → API & Webhook)
```

Marker-e în `listings.sync_state`:

| Câmp | Semnificație |
|------|-------------|
| `prelist: true` | Listing creat prin fluxul de prelistare |
| `prelist_validated_at` | ISO timestamp — setat O SINGURĂ DATĂ la prima aprobare; după acest moment reconcile-ul NU mai suprascrie `category`/`characteristics` (protejează datele completate ulterior de procesul extern) |
| `category`, `characteristics`, `part_number_key` | Valorile atribuite de eMAG la validare |


---

## Detectarea validării

1. **Callback nativ eMAG „Approved documentation"** (recomandat): configurează în interfața
   eMAG Marketplace URL-ul `documentationApprovedUrl` din răspunsul `getWebhookInfo`
   (`GET /plugins/:id/webhook`): `{PUBLIC_API_URL}/webhooks/emag/{token}/documentation-approved`.
   La primire, OpenSales declanșează imediat un ciclu de reconciliere.
2. **Fallback automat**: cron-ul de reconciliere eMAG (la 2 ore) + trigger manual
   `POST /import/emag/sync-validation`.

---

## Notificarea procesului extern

URL-ul se configurează **în platformă**: Setări → tab „API & Webhook" → card „Prelistare eMAG"
(salvat pe workspace: `PATCH /workspace` cu `prelistValidatedWebhookUrl`; gol = dezactivat).

Toate produsele prelistate validate de eMAG **într-un singur ciclu de reconciliere** sunt trimise
**batched, într-un singur POST** (nu un request per produs):

```json
POST {prelistValidatedWebhookUrl}
{
  "products": [
    {
      "sku": "TRICOU-ALB-M",
      "platform": "emag-ro",
      "category_id": 506,
      "characteristics": [{ "id": 38, "value": "Audio" }]
    },
    {
      "sku": "PANTALON-NEGRU-L",
      "platform": "emag-ro",
      "category_id": 1204,
      "characteristics": [{ "id": 38, "value": "Casual" }]
    }
  ]
}
```

`sku` e mereu prezent (produsul e creat în aceeași operație de prelistare care creează listing-ul).
Nu se trimit `listingId` sau `part_number_key` — sunt identificatori interni OpenSales, nu au sens
pentru procesul extern.

Trimiterea rulează ca job de coadă (`PRELIST_VALIDATED_WEBHOOK_JOB`): la eșec (non-2xx sau eroare
de rețea), pg-boss **reîncearcă automat** (3 încercări, backoff exponențial). Dacă toate încercările
eșuează, datele rămân oricum interogabile prin `GET /listings` — nu se pierd, doar notificarea.

---

## Pasul următor (procesul de completare — în afara acestui endpoint)

După notificare, procesul extern (LLM + validare manuală):
1. Completează caracteristicile rămase → `PATCH /listings/:id` (merge pe sync_state).
2. Retrimite oferta completă pe eMAG → repush listing.
3. Adaugă oferta Trendyol + stocul real → `POST /import/products` cu același SKU
   (calea de conflict adaugă oferte pe marketplace-uri noi și actualizează stocul).
