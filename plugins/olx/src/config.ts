import { z } from 'zod';

/**
 * OLX Europe Partner API v2 — constante de integrare.
 * Spec: docs/olx-api/partner_api.yaml (OpenAPI 3.0.2).
 */

/** Base URL pentru toate resursele API (adverts, categories, threads, etc.). */
export const OLX_BASE_URL = 'https://www.olx.ro/api/partner';

/**
 * Endpoint OAuth2 — NU este sub /api/partner. Folosit pentru toate grant types
 * (client_credentials, authorization_code, refresh_token).
 */
export const OLX_TOKEN_URL = 'https://www.olx.ro/api/open/oauth/token';

/**
 * Valoarea header-ului `Version`, obligatoriu pe FIECARE request către resurse.
 * Doc § Versioning: "Version header is required".
 */
export const OLX_VERSION_HEADER = '2.0';

/** Scope implicit cerut la obținerea token-ului. Doc § Scopes. */
export const OLX_DEFAULT_SCOPE = 'v2 read write';

/**
 * Secret schema validat la onConfigure. Stocat criptat în /plugins/olx/data/.
 *
 * `clientId` / `clientSecret` — credențialele aplicației OLX (obligatorii pentru
 *   orice grant type).
 * `refreshToken` — token-ul utilizatorului obținut prin flow-ul authorization_code.
 *   Opțional: acțiunile de tip "config" (categorii) folosesc client_credentials și
 *   nu au nevoie de el; acțiunile de utilizator (adverts/messages) îl cer.
 *   OLX rotește refresh token-ul (unul nou emis zilnic) — clientul îl persistă la fiecare reînnoire.
 */
export const SecretSchema = z.object({
  clientId: z.string().min(1, 'Client ID OLX obligatoriu'),
  clientSecret: z.string().min(1, 'Client Secret OLX obligatoriu'),
  refreshToken: z.string().min(1).optional(),
});

export type OlxSecrets = z.infer<typeof SecretSchema>;
