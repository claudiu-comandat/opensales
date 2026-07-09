'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ReactElement } from 'react';

import { getApiClient } from '@/lib/api-client';

interface RejectedSku {
  sku: string;
  productId: string;
  listingId: string;
  platform: string;
  lastSyncedAt: string | null;
}

interface RejectedErrorGroup {
  error: string;
  productCount: number;
  listingCount: number;
  skus: RejectedSku[];
}

interface RejectedChannelReport {
  channel: string;
  label: string;
  productCount: number;
  listingCount: number;
  groups: RejectedErrorGroup[];
}

interface RejectedListingsReport {
  totalListings: number;
  totalProducts: number;
  channels: RejectedChannelReport[];
}

function matchesFilter(group: RejectedErrorGroup, needle: string): boolean {
  if (needle.length === 0) return true;
  if (group.error.toLowerCase().includes(needle)) return true;
  return group.skus.some((s) => s.sku.toLowerCase().includes(needle));
}

export function RejectedListingsViewer(): ReactElement {
  const [report, setReport] = useState<RejectedListingsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getApiClient().get<RejectedListingsReport>('/debug/rejected-listings');
      setReport(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcare');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const needle = filter.trim().toLowerCase();

  const channels = useMemo<RejectedChannelReport[]>(() => {
    if (!report) return [];
    if (needle.length === 0) return report.channels;
    return report.channels
      .map((c) => ({ ...c, groups: c.groups.filter((g) => matchesFilter(g, needle)) }))
      .filter((c) => c.groups.length > 0);
  }, [report, needle]);

  async function copySkus(key: string, skus: RejectedSku[]): Promise<void> {
    const text = skus.map((s) => s.sku).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // clipboard indisponibil (ex. context non-secure) — ignorăm silențios
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-[12px] hover:bg-ink-50"
          disabled={loading}
        >
          {loading ? 'Se încarcă…' : 'Reîncarcă'}
        </button>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrează după eroare sau SKU…"
          className="min-w-[220px] flex-1 rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-[13px]"
        />
        {report ? (
          <span className="text-[12px] text-ink-500">
            {report.totalProducts}{' '}
            {report.totalProducts === 1 ? 'produs respins' : 'produse respinse'} ·{' '}
            {report.totalListings} {report.totalListings === 1 ? 'ofertă' : 'oferte'}
          </span>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="text-[13px] text-red-600">
          {error}
        </p>
      ) : null}

      {report !== null && report.channels.length === 0 && !loading ? (
        <p className="text-[13px] text-ink-500">Nicio ofertă cu documentație respinsă. 🎉</p>
      ) : null}

      {channels.length === 0 && report !== null && report.channels.length > 0 && !loading ? (
        <p className="text-[13px] text-ink-500">Niciun rezultat pentru filtrul „{filter}”.</p>
      ) : null}

      <div className="flex flex-col gap-5">
        {channels.map((channel) => (
          <div key={channel.channel}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-ink-900">{channel.label}</h3>
              <span className="text-[12px] text-ink-500">
                {channel.productCount} {channel.productCount === 1 ? 'produs' : 'produse'} ·{' '}
                {channel.groups.length} {channel.groups.length === 1 ? 'eroare' : 'erori'}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-ink-200">
              {channel.groups.map((group) => {
                const key = `${channel.channel}::${group.error}`;
                const open = openKey === key;
                return (
                  <div key={key} className="border-b border-ink-100 last:border-0">
                    <button
                      type="button"
                      onClick={() => setOpenKey(open ? null : key)}
                      className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-ink-50"
                    >
                      <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                        {group.productCount} {group.productCount === 1 ? 'produs' : 'produse'}
                      </span>
                      <span className="flex-1 text-[12.5px] text-red-700">{group.error}</span>
                      {group.listingCount !== group.productCount ? (
                        <span className="mt-0.5 shrink-0 text-[11px] text-ink-400">
                          {group.listingCount} oferte
                        </span>
                      ) : null}
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-ink-400">
                        {open ? '▾' : '▸'}
                      </span>
                    </button>
                    {open ? (
                      <div className="border-t border-ink-100 bg-ink-50 px-3 py-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                            SKU-uri afectate ({group.skus.length})
                          </span>
                          <button
                            type="button"
                            onClick={() => void copySkus(key, group.skus)}
                            className="rounded border border-ink-200 bg-surface px-2 py-0.5 text-[11px] hover:bg-ink-100"
                          >
                            {copiedKey === key ? 'Copiat ✓' : 'Copiază SKU-urile'}
                          </button>
                        </div>
                        <div className="max-h-72 overflow-auto rounded border border-ink-200 bg-surface">
                          <table className="w-full text-[12px]">
                            <thead className="sticky top-0 bg-surface">
                              <tr className="text-left text-[10.5px] uppercase tracking-wide text-ink-400">
                                <th className="px-2 py-1.5 font-medium">SKU</th>
                                <th className="px-2 py-1.5 font-medium">Platformă</th>
                                <th className="px-2 py-1.5 font-medium">Ultima sincronizare</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.skus.map((s) => (
                                <tr key={s.listingId} className="border-t border-ink-100">
                                  <td className="px-2 py-1.5 font-mono text-ink-900">{s.sku}</td>
                                  <td className="px-2 py-1.5 font-mono text-[11px] text-ink-600">
                                    {s.platform}
                                  </td>
                                  <td className="px-2 py-1.5 font-mono text-[11px] text-ink-500">
                                    {s.lastSyncedAt
                                      ? new Date(s.lastSyncedAt).toLocaleString('ro-RO')
                                      : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
