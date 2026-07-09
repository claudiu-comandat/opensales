'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

interface UnmatchedItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: { amountMinor: string; currency: string };
}

interface ProductResult {
  id: string;
  sku: string;
  name: string;
  ean: string | null;
  stockQuantity: number;
  images: { url: string }[] | null;
  price: { amountMinor: string; currency: string };
}

interface ManualMatchingProps {
  orderId: string;
  unmatchedItems: UnmatchedItem[];
}

function formatMoney(value: { amountMinor: string; currency: string }): string {
  const amount = Number(value.amountMinor) / 100;
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

interface ProductSearchProps {
  onSelect: (product: ProductResult) => void;
  selected: ProductResult | null;
}

function ProductSearch({ onSelect, selected }: ProductSearchProps): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const client = getApiClient();
      const res = await client.get<{ data: ProductResult[] }>('/products', {
        query: { search: q, pageSize: 10 },
      });
      setResults(res.data ?? []);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(val), 300);
  }

  function handleSelect(p: ProductResult): void {
    onSelect(p);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-brand-500 bg-brand-50 px-3 py-2">
        {selected.images?.[0]?.url ? (
          <img
            src={selected.images[0].url}
            alt={selected.name}
            className="h-8 w-8 rounded border border-ink-200 object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-ink-300 text-[10px] text-ink-400">
            —
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-ink-900">{selected.name}</div>
          <div className="flex items-center gap-2 text-[11px] text-ink-500">
            <span className="font-mono">{selected.sku}</span>
            {selected.ean ? <span>EAN: {selected.ean}</span> : null}
            <span>Stoc: {selected.stockQuantity}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null as unknown as ProductResult)}
          className="shrink-0 text-[11px] text-ink-400 hover:text-danger"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        placeholder="Caută după nume, SKU sau EAN..."
        value={query}
        onChange={handleChange}
        autoComplete="off"
      />
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-[10px] border border-ink-200 bg-white shadow-lg">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-50"
            >
              {p.images?.[0]?.url ? (
                <img
                  src={p.images[0].url}
                  alt={p.name}
                  className="h-9 w-9 shrink-0 rounded border border-ink-200 object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-ink-300 text-[10px] text-ink-400">
                  —
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink-900">{p.name}</div>
                <div className="flex items-center gap-2 text-[11px] text-ink-500">
                  <span className="font-mono">{p.sku}</span>
                  {p.ean ? <span>EAN: {p.ean}</span> : null}
                  <span className="ml-auto text-ink-700">
                    {formatMoney(p.price)} · {p.stockQuantity} buc.
                  </span>
                </div>
              </div>
            </button>
          ))}
          {results.length === 0 && !loading && (
            <div className="px-3 py-3 text-[13px] text-ink-500">Niciun produs găsit.</div>
          )}
        </div>
      )}
      {open && results.length === 0 && !loading && query.length >= 2 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-[10px] border border-ink-200 bg-white px-3 py-3 shadow-lg text-[13px] text-ink-500">
          Niciun produs găsit.
        </div>
      )}
    </div>
  );
}

export function ManualMatchingButton({
  orderId,
  unmatchedItems,
}: ManualMatchingProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, ProductResult | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleSelect(itemId: string, product: ProductResult | null): void {
    setSelections((prev) => ({ ...prev, [itemId]: product }));
  }

  async function handleSubmit(): Promise<void> {
    const matched = Object.entries(selections).filter(
      (entry): entry is [string, ProductResult] => entry[1] !== null,
    );
    if (matched.length === 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const client = getApiClient();
      await Promise.all(
        matched.map(([itemId, product]) =>
          client.post(`/orders/${orderId}/items/${itemId}/match`, {
            productId: product.id,
          }),
        ),
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const matchedCount = Object.values(selections).filter(Boolean).length;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border-warning text-warning hover:bg-warning-bg"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Manual Matching
        <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-white">
          {unmatchedItems.length}
        </span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !submitting && setOpen(false)}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] border border-ink-200 bg-surface shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-warning-bg text-warning">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div>
                <div className="text-[14px] font-semibold text-ink-900">Manual Matching</div>
                <div className="text-[12px] text-ink-500">
                  {unmatchedItems.length}{' '}
                  {unmatchedItems.length === 1 ? 'produs neidentificat' : 'produse neidentificate'}{' '}
                  în această comandă
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setOpen(false)}
                className="ml-auto text-ink-400 hover:text-ink-700 disabled:opacity-50"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {unmatchedItems.map((item) => (
                <div key={item.id} className="rounded-[14px] border border-ink-200 bg-ink-50 p-4">
                  {/* Item info */}
                  <div className="mb-3 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-ink-300 bg-surface text-[10px] text-ink-400">
                      —
                    </div>
                    <div>
                      <div className="text-[13px] font-medium text-ink-900 leading-snug">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[11px] text-ink-500">{item.sku}</span>
                        <span className="text-[11px] text-ink-500">
                          × {item.quantity} · {formatMoney(item.unitPrice)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Product search */}
                  <div className="space-y-1.5">
                    <label className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink-500">
                      Selectează produsul din catalog
                    </label>
                    <ProductSearch
                      onSelect={(p) => handleSelect(item.id, p)}
                      selected={selections[item.id] ?? null}
                    />
                  </div>
                </div>
              ))}

              {error && (
                <div className="rounded-[10px] border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-5 py-4">
              <span className="text-[12.5px] text-ink-500">
                {matchedCount} din {unmatchedItems.length} produse selectate
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setOpen(false)}
                >
                  Anulează
                </Button>
                <Button
                  size="sm"
                  disabled={matchedCount === 0 || submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting
                    ? 'Se salvează...'
                    : `Salvează ${matchedCount > 0 ? `(${matchedCount})` : ''}`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
