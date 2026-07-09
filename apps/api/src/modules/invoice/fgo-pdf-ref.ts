import { execFile } from 'node:child_process';

// Seria facturii e fixă per platformă Trendyol (Trendyol nu trimite serie/număr).
const SERIES_BY_MARKETPLACE: Record<string, string> = {
  'trendyol-ro': 'TR',
  'trendyol-gr': 'TRGR',
  'trendyol-bg': 'TRBG',
};

// În textul PDF-ului FGO seria+numărul sunt pe linia de sub "FACTURA":
// "TR 1638" / "TRGR 00126". TRGR/TRBG înaintea lui TR ca alternanța să nu
// se oprească la "TR". Prima apariție = factura (e sus, lângă "FACTURA").
const REF_RE = /\b(TRGR|TRBG|TR)\s+(\d+)\b/;

/** Parsează seria+numărul din textul extras al facturii. Pur — testabil fără PDF. */
export function parseInvoiceRefFromText(
  text: string,
  marketplace: string,
): { series: string; number: string } {
  const m = REF_RE.exec(text);
  if (!m?.[1] || !m[2]) throw new Error('serie+număr negăsite în textul facturii');
  const series = m[1];
  const expected = SERIES_BY_MARKETPLACE[marketplace];
  if (expected && series !== expected) {
    throw new Error(
      `serie "${series}" nu corespunde platformei ${marketplace} (aștept ${expected})`,
    );
  }
  return { series, number: m[2] };
}

// pdftotext citește PDF de la stdin (-) și scrie text la stdout (-).
// Necesită poppler-utils în imagine (vezi Dockerfile).
function pdfToText(pdf: Buffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const fail = (e: unknown): void => reject(e instanceof Error ? e : new Error(String(e)));
    const proc = execFile(
      'pdftotext',
      ['-layout', '-', '-'],
      { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => (err ? fail(err) : resolve(stdout)),
    );
    // Dacă pdftotext lipsește/eșuează la spawn, nu lăsa stdin-ul rupt să arunce
    // un 'error' necapturat (ar crăpa procesul). Respinge curat.
    proc.on('error', fail);
    proc.stdin?.on('error', () => undefined);
    proc.stdin?.end(pdf);
  });
}

/** Descarcă PDF-ul facturii FGO și extrage seria+numărul. */
export async function fetchInvoiceRef(
  url: string,
  marketplace: string,
): Promise<{ series: string; number: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch PDF ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
    throw new Error('răspuns non-PDF (link mort la FGO) — necesită rezolvare manuală');
  }
  return parseInvoiceRefFromText(await pdfToText(buf), marketplace);
}
