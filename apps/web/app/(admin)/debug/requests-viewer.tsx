'use client';

import { useCallback, useEffect, useState } from 'react';

import { getApiClient } from '@/lib/api-client';

interface RequestLogListItem {
  id: string;
  pluginId: string;
  method: string;
  url: string;
  path: string;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  correlation: Record<string, string | number> | null;
  createdAt: string;
}

interface RequestLogDetail extends RequestLogListItem {
  requestBody: unknown;
  requestHeaders: Record<string, string> | null;
  responseBody: unknown;
  responseSizeBytes: number | null;
}

interface Plugin {
  id: string;
  displayName: string;
  packageName: string;
}

const SINCE_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Ultimele 15 min', value: 15 },
  { label: 'Ultima oră', value: 60 },
  { label: 'Ultimele 24h', value: 24 * 60 },
  { label: 'Toate', value: undefined },
];

function statusColor(status: number | null, error: string | null): string {
  if (error !== null) return 'bg-red-100 text-red-800';
  if (status === null) return 'bg-gray-100 text-gray-600';
  if (status >= 200 && status < 300) return 'bg-green-100 text-green-800';
  if (status === 429) return 'bg-amber-100 text-amber-800';
  if (status >= 400) return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-600';
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable]';
  }
}

export function RequestsViewer({ plugins }: { plugins: Plugin[] }): React.ReactElement {
  const [rows, setRows] = useState<RequestLogListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pluginId, setPluginId] = useState<string>('');
  const [path, setPath] = useState<string>('');
  const [q, setQ] = useState<string>('');
  const [sinceMinutes, setSinceMinutes] = useState<number | undefined>(60);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequestLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (pluginId) params.set('pluginId', pluginId);
      if (path) params.set('path', path);
      if (q) params.set('q', q);
      if (sinceMinutes !== undefined) params.set('sinceMinutes', String(sinceMinutes));
      params.set('limit', '200');
      const res = await getApiClient().get<{ data: RequestLogListItem[] }>(
        `/debug/requests?${params.toString()}`,
      );
      setRows(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare');
    } finally {
      setLoading(false);
    }
  }, [pluginId, path, q, sinceMinutes]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleOpen = useCallback(
    async (id: string): Promise<void> => {
      if (openId === id) {
        setOpenId(null);
        setDetail(null);
        return;
      }
      setOpenId(id);
      setDetail(null);
      setDetailLoading(true);
      try {
        const res = await getApiClient().get<RequestLogDetail>(`/debug/requests/${id}`);
        setDetail(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Eroare la încărcare detaliu');
      } finally {
        setDetailLoading(false);
      }
    },
    [openId],
  );

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-5">
        <select
          value={pluginId}
          onChange={(e) => setPluginId(e.target.value)}
          className="rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-[13px]"
        >
          <option value="">Toate plugin-urile</option>
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="path (ex: order/read)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-[13px]"
        />
        <input
          type="text"
          placeholder="caută în body / order id..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-[13px] md:col-span-2"
        />
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
      </div>

      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-[12px] hover:bg-ink-50"
          disabled={loading}
        >
          {loading ? 'Se încarcă…' : 'Reîncarcă'}
        </button>
        <span className="text-[12px] text-ink-500">
          {rows.length} {rows.length === 1 ? 'request' : 'request-uri'}
        </span>
      </div>

      {error !== null ? (
        <p role="alert" className="text-[13px] text-red-600">
          {error}
        </p>
      ) : null}

      {rows.length === 0 && !loading ? (
        <p className="text-[13px] text-ink-500">
          Niciun request înregistrat pentru filtrele alese.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-ink-200">
          {rows.map((r) => {
            const open = openId === r.id;
            const pluginName = plugins.find((p) => p.id === r.pluginId)?.displayName ?? r.pluginId;
            return (
              <div key={r.id} className="border-b border-ink-100 last:border-0">
                <button
                  type="button"
                  onClick={() => void toggleOpen(r.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-[12.5px] hover:bg-ink-50"
                >
                  <span className="font-mono text-[11px] text-ink-500">
                    {new Date(r.createdAt).toLocaleTimeString('ro-RO')}
                  </span>
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-700">
                    {r.method}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${statusColor(r.status, r.error)}`}
                  >
                    {r.error !== null ? 'ERR' : (r.status ?? '—')}
                  </span>
                  <span className="font-mono text-[11.5px] text-ink-900">{r.path}</span>
                  <span className="text-[11px] text-ink-500">{pluginName}</span>
                  <span className="ml-auto font-mono text-[11px] text-ink-500">
                    {r.durationMs !== null ? `${r.durationMs}ms` : ''}
                  </span>
                  {r.correlation?.externalOrderId !== undefined ? (
                    <span className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[10.5px] text-brand-700">
                      #{r.correlation.externalOrderId}
                    </span>
                  ) : null}
                </button>
                {open ? (
                  <div className="border-t border-ink-100 bg-ink-50 px-3 py-3">
                    {detailLoading ? (
                      <p className="text-[12px] text-ink-500">Se încarcă…</p>
                    ) : detail === null ? (
                      <p className="text-[12px] text-ink-500">—</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                            Request
                          </div>
                          <div className="mb-1 font-mono text-[11px] text-ink-600">
                            {detail.method} {detail.url}
                          </div>
                          <pre className="max-h-96 overflow-auto rounded border border-ink-200 bg-surface p-2 font-mono text-[11px] text-ink-900">
                            {formatJson(detail.requestBody)}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                              Response
                            </span>
                            <span className="font-mono text-[11px] text-ink-500">
                              {detail.responseSizeBytes !== null
                                ? `${(detail.responseSizeBytes / 1024).toFixed(1)} KB`
                                : ''}
                            </span>
                          </div>
                          {detail.error !== null ? (
                            <div className="mb-1 rounded border border-red-200 bg-red-50 p-2 font-mono text-[11px] text-red-700">
                              {detail.error}
                            </div>
                          ) : null}
                          <pre className="max-h-96 overflow-auto rounded border border-ink-200 bg-surface p-2 font-mono text-[11px] text-ink-900">
                            {formatJson(detail.responseBody)}
                          </pre>
                        </div>
                      </div>
                    )}
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
