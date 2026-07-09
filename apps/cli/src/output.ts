import kleur from 'kleur';

export type OutputFormat = 'text' | 'json';

let format: OutputFormat = 'text';

export function setOutputFormat(f: OutputFormat): void {
  format = f;
}

export function getOutputFormat(): OutputFormat {
  return format;
}

export function printSuccess(msg: string, data?: unknown): void {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify({ ok: true, msg, data })}\n`);
    return;
  }
  process.stdout.write(`${kleur.green('OK')} ${msg}\n`);
  if (data !== undefined) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }
}

export function printError(msg: string, err?: unknown): void {
  if (format === 'json') {
    process.stderr.write(`${JSON.stringify({ ok: false, error: msg, detail: errToObj(err) })}\n`);
    return;
  }
  process.stderr.write(`${kleur.red('ERR')} ${msg}\n`);
  if (err !== undefined) {
    process.stderr.write(`  ${errToString(err)}\n`);
  }
}

export function printTable(headers: string[], rows: string[][]): void {
  if (format === 'json') {
    const data = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const fmt = (cols: string[]): string => cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
  process.stdout.write(`${kleur.bold(fmt(headers))}\n`);
  process.stdout.write(`${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
  for (const r of rows) {
    process.stdout.write(`${fmt(r.map((c) => c ?? ''))}\n`);
  }
}

function errToObj(e: unknown): unknown {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return e;
}

function errToString(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
