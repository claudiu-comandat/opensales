import { createHash } from 'node:crypto';

/**
 * SHA-1 hex (uppercase) — formatul așteptat de FGO pentru câmpul `Hash`.
 *
 * Doc FGO v7 §1 Autentificare: `Hash = SHA1(CodUnic + PrivateKey + variabil)`.
 * Variabilul diferă în funcție de endpoint:
 *   - /factura/emitere → Client.Denumire
 *   - alte /factura/* → Numar (sau NumarFactura)
 *   - /articol/* → CodUnic (din nou)
 *   - /nomenclator/* → fără variabil (doar SHA1(CodUnic + PrivateKey))
 */
function sha1Hex(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex').toUpperCase();
}

/** Pentru POST /factura/emitere. */
export function buildHashForEmitere(
  codUnic: string,
  privateKey: string,
  clientDenumire: string,
): string {
  return sha1Hex(codUnic + privateKey + clientDenumire);
}

/**
 * Pentru toate celelalte endpoint-uri /factura/* care iau `Numar` în payload
 * (stornare, anulare, ștergere, getstatus, print).
 */
export function buildHashForNumar(codUnic: string, privateKey: string, numar: string): string {
  return sha1Hex(codUnic + privateKey + numar);
}

/** Pentru /factura/incasare și /factura/stergereincasare (folosesc `NumarFactura`). */
export function buildHashForNumarFactura(
  codUnic: string,
  privateKey: string,
  numarFactura: string,
): string {
  return sha1Hex(codUnic + privateKey + numarFactura);
}

/** Pentru /articol/* (gestiune, articolemodificate) — variabilul este CodUnic. */
export function buildHashForCodUnic(codUnic: string, privateKey: string): string {
  return sha1Hex(codUnic + privateKey + codUnic);
}

/** Pentru /nomenclator/* — Hash = SHA1(CodUnic + PrivateKey), fără variabil suplimentar. */
export function buildHashForNomenclator(codUnic: string, privateKey: string): string {
  return sha1Hex(codUnic + privateKey);
}
