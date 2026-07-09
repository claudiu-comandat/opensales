# @opensales-plugin/olx

Conector OpenSales pentru **OLX.ro** (OLX Europe Partner API v2).

## Capabilități

| Acțiune | Endpoint OLX | Context auth | Permisiune |
|---|---|---|---|
| `syncCategories` | `GET /categories` | client_credentials | listings:read |
| `readCategoryAttributes` | `GET /categories/{id}/attributes` | client_credentials | listings:read |
| `createAdvert` | `POST /adverts` | authorization_code (user) | listings:write |
| `updateAdvert` | `PUT /adverts/{id}` | user | listings:write |
| `deleteAdvert` | `DELETE /adverts/{id}` | user | listings:write |
| `syncAdverts` | `GET /adverts` | user | listings:read |
| `advertCommand` | `POST /adverts/{id}/commands` | user | listings:write |
| `readMessages` | `GET /threads/{id}/messages` | user | listings:read |
| `sendMessage` | `POST /threads/{id}/messages` | user | listings:write |

Strategie: 100% API-based (REST/JSON).

## Autentificare

OAuth2 pe `https://www.olx.ro/api/open/oauth/token`. Fiecare request către resurse
poartă `Authorization: Bearer <token>` + `Version: 2.0`.

- **client_credentials** — date de configurare (categorii). Nu poate posta anunțuri.
- **authorization_code / refresh_token** — acțiuni în numele utilizatorului (adverts, mesaje).
  Refresh token-ul e rotit de OLX (unul nou emis zilnic) și e persistat automat în
  storage-ul criptat al plugin-ului (`plugins/olx/data/`).

## Configurare

Secrete (`secretSchema`): `clientId`, `clientSecret`, `refreshToken` (opțional, din
flow-ul authorization_code). Config: `callbackUrl`.

## Bani

OpenSales stochează prețul ca `amountMinor` (bigint) + `currency`. OLX cere `price.value`
în unități majore — conversia se face la graniță (`src/adverts/money.ts`).

## Evenimente emise

Plugin-ul notifică platforma (`events:emit`) după fiecare modificare reușită de anunț,
ca alte componente (UI, propagare către alte marketplace-uri) să poată reacționa:

| Acțiune | Eveniment | Payload |
|---|---|---|
| `createAdvert` | `listing.created` | `marketplace`, `pluginId`, `advertId`, `externalId?`, `status?` |
| `updateAdvert` | `listing.updated` | idem |
| `advertCommand` (activate/deactivate/finish/extend) | `listing.updated` | `marketplace`, `pluginId`, `advertId`, `command` |
| `deleteAdvert` | `listing.deleted` | `marketplace`, `pluginId`, `advertId` |

`externalId` (id-ul propriu al vânzătorului) permite maparea înapoi la produsul OpenSales.
Emiterea e fire-and-forget: o eroare de event bus e logată (`logger.warn`), nu invalidează
operația deja reușită pe OLX. Vezi `src/events.ts`.

## Deferred (nu sunt implementate în această versiune)

Paid-features/packets (promovare plătită), statistici/logo-uri advert, users/business,
billing/invoices, thread commands (mark-as-read / set-favourite), locations/suggestion.
Acestea pot fi adăugate ulterior urmând același pattern.
