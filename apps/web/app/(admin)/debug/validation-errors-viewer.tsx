'use client';

import { useCallback, useEffect, useState } from 'react';

import { getApiClient } from '@/lib/api-client';

interface ValidationError {
  id: string;
  pluginId: string;
  path: string;
  url: string;
  error: string | null;
  requestBody: unknown;
  createdAt: string;
}

const SINCE_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Ultimele 15 min', value: 15 },
  { label: 'Ultima oră', value: 60 },
  { label: 'Ultimele 24h', value: 24 * 60 },
  { label: 'Toate', value: undefined },
];

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

interface Plugin {
  id: string;
  displayName: string;
}

export function ValidationErrorsViewer({ plugins }: { plugins: Plugin[] }): React.ReactElement {
  const [rows, setRows] = useState<ValidationError[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinceMinutes, setSinceMinutes] = useState<number | undefined>(60);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sinceMinutes !== undefined) params.set('sinceMinutes', String(sinceMinutes));
      const res = await getApiClient().get<{ data: ValidationError[] }>(
        `/debug/zod-errors?${params.toString()}`,
      );
      setRows(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare');
    } finally {
      setLoading(false);
    }
  }, [sinceMinutes]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select
          value={sinceMinutes ?? ''}
          onChange={(e) =>
            setSinceMinutes(e.target.value === '' ? undefined : Number(e.target.value))
          }
          className="rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-[13px]"
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ''}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-[12px] hover:bg-ink-50"
          disabled={loading}
        >
          {loading ? 'Se încarcă…' : 'Reîncarcă'}
        </button>
        <span className="text-[12px] text-ink-500">
          {rows.length} {rows.length === 1 ? 'eroare' : 'erori'}
        </span>
      </div>

      {error !== null ? (
        <p role="alert" className="text-[13px] text-red-600">
          {error}
        </p>
      ) : null}

      {rows.length === 0 && !loading ? (
        <p className="text-[13px] text-ink-500">Nicio eroare de validare în intervalul ales.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-ink-200">
          {rows.map((r) => {
            const open = openId === r.id;
            const pluginName = plugins.find((p) => p.id === r.pluginId)?.displayName ?? r.pluginId;
            const marketplace = r.url.replace('[validation-error] ', '');
            return (
              <div key={r.id} className="border-b border-ink-100 last:border-0">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-[12.5px] hover:bg-ink-50"
                >
                  <span className="font-mono text-[11px] text-ink-500">
                    {new Date(r.createdAt).toLocaleTimeString('ro-RO')}
                  </span>
                  <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10.5px] text-red-800">
                    ZOD
                  </span>
                  <span className="font-mono text-[11.5px] text-ink-900">{marketplace}</span>
                  <span className="text-[11px] text-ink-500">{pluginName}</span>
                  <span className="ml-auto max-w-[400px] truncate font-mono text-[11px] text-red-600">
                    {r.error}
                  </span>
                </button>
                {open ? (
                  <div className="border-t border-ink-100 bg-ink-50 px-3 py-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                          Payload trimis
                        </div>
                        <pre className="max-h-96 overflow-auto rounded border border-ink-200 bg-surface p-2 font-mono text-[11px] text-ink-900">
                          {formatJson(r.requestBody)}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                          Eroare Zod
                        </div>
                        <div className="rounded border border-red-200 bg-red-50 p-2 font-mono text-[11px] text-red-800 whitespace-pre-wrap">
                          {r.error ?? '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
