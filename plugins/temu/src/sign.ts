import { createHash } from 'node:crypto';

/**
 * Calculează semnătura MD5 pentru un request Temu Open API.
 *
 * Algoritmul (din documentația oficială):
 *   1. Colectează toți parametrii din request body (exclusiv `sign` și `app_secret`).
 *   2. Sortează cheile alfabetic (ASCII).
 *   3. Concatenează `key + value` pentru fiecare pereche:
 *      - valorile de tip string → fără ghilimele
 *      - restul → JSON.stringify (numbers, booleans, objects, arrays)
 *   4. Învelește cu appSecret: `${appSecret}${concat}${appSecret}`
 *   5. MD5 → uppercase hex
 *
 * @param appSecret  App secret-ul din Temu Partner Platform (NU se include în body).
 * @param params     Toți parametrii request body (inclusiv app_key, access_token, timestamp, type etc.).
 *                   Nu trebuie să conțină `sign` sau `app_secret`.
 */
export function computeSign(appSecret: string, params: Record<string, unknown>): string {
  const entries = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let concat = '';
  for (const [key, value] of entries) {
    // String values — fără ghilimele; alte tipuri — JSON.stringify
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    concat += key + serialized;
  }

  const payload = appSecret + concat + appSecret;
  return createHash('md5').update(payload, 'utf8').digest('hex').toUpperCase();
}
