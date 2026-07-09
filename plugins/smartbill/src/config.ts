import { z } from 'zod';

/**
 * URL de bază al SmartBill Cloud REST API.
 * Swagger §"URL de baza": `https://ws.smartbill.ro/SBORO/api/`.
 *
 * SmartBill nu expune un host de sandbox separat — toate apelurile merg către
 * mediul de producție. Testarea se face cu un cont real (sau cont demo) și serii
 * dedicate. URL-ul rămâne constant; îl ținem aici pentru un singur punct de
 * configurare.
 */
export const SMARTBILL_API_URL = 'https://ws.smartbill.ro/SBORO/api';

/**
 * Schema secrets validată la onConfigure. Stocată criptat în /plugins/smartbill/data/.
 *
 * `companyVatCode` (CIF) + `username` (email cont) + `token` (token API) sunt
 * credențialele de bază — fără ele clientul nu poate face nicio cerere
 * autentificată. Autentificarea SmartBill e HTTP Basic peste `email:token`.
 *
 * Restul câmpurilor sunt configurabile per instanță — trimise împreună cu
 * secrets pentru a păstra un singur "blob de configurare" la onConfigure.
 */
export const SecretSchema = z.object({
  companyVatCode: z.string().min(1, 'CIF firmă (companyVatCode) obligatoriu'),
  username: z.string().min(1, 'Email cont SmartBill obligatoriu'),
  token: z.string().min(1, 'Token API SmartBill obligatoriu'),
  defaultSeriesName: z.string().min(1).optional(),
  language: z.string().min(1).default('RO'),
  useStock: z.boolean().default(false),
  saveClientToDb: z.boolean().default(false),
  autoEmitOnOrderCreated: z.boolean().default(false),
});

export type SmartBillSecrets = z.infer<typeof SecretSchema>;

/**
 * Construiește header-ul `Authorization: Basic base64(email:token)`.
 *
 * SmartBill folosește Basic auth preemptiv: string-ul `username:token` este
 * codat Base64. `username` = adresa de email a contului, `token` = token-ul API
 * din Contul Meu > Integrări > API.
 */
export function buildBasicAuthHeader(username: string, token: string): string {
  const encoded = Buffer.from(`${username}:${token}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}
