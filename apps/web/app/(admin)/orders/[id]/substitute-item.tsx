'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

interface OrderItemInfo {
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

interface SubstituteItemDialogProps {
  orderId: string;
  item: OrderItemInfo;
  onClose: () => void;
}

function formatMoney(value: { amountMinor: string; currency: string }): string {
  const amount = Number(value.amountMinor) / 100;
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function ProductSearch({
  onSelect,
  selected,
}: {
  onSelect: (product: ProductResult | null) => void;
  selected: ProductResult | null;
}): ReactElement {
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
          onClick={() => onSelect(null)}
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

export function SubstituteItemDialog({
  orderId,
  item,
  onClose,
}: SubstituteItemDialogProps): ReactElement {
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm(): Promise<void> {
    if (!selectedProduct) return;
    setSubmitting(true);
    setError(null);
    try {
      const client = getApiClient();
      await client.patch(`/orders/${orderId}/items/${item.id}/substitute`, {
        productId: selectedProduct.id,
      });
      onClose();
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setError(msg);
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && onClose()} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[20px] border border-ink-200 bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-ink-100 text-ink-700">
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
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink-900">Modificare articol</div>
            <div className="text-[12px] text-ink-500">
              Modificarea este locală — nu afectează comanda pe platformă
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
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
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Articol curent */}
          <div>
            <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink-500">
              Articol curent
            </div>
            <div className="rounded-[12px] border border-ink-200 bg-ink-50 px-4 py-3">
              <div className="text-[13px] font-medium text-ink-900 leading-snug">{item.name}</div>
              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink-500">
                <span className="font-mono">{item.sku}</span>
                <span>× {item.quantity}</span>
                <span>· {formatMoney(item.unitPrice)}</span>
              </div>
            </div>
          </div>

          {/* Săgeată */}
          <div className="flex items-center justify-center text-ink-400">
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
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </div>

          {/* Selectare produs nou */}
          <div>
            <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink-500">
              Înlocuiește cu
            </div>
            <ProductSearch onSelect={setSelectedProduct} selected={selectedProduct} />
          </div>

          {/* Confirmare inline */}
          {confirming && selectedProduct ? (
            <div className="rounded-[12px] border border-warning bg-warning-bg px-4 py-3">
              <div className="text-[13px] font-medium text-warning mb-2">
                Ești sigur că dorești modificarea articolului din această comandă?
              </div>
              <div className="text-[12px] text-ink-700 mb-3">
                <span className="font-medium">{item.name}</span>
                <span className="mx-2 text-ink-400">→</span>
                <span className="font-medium">{selectedProduct.name}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={submitting}
                  onClick={() => void handleConfirm()}
                  className="bg-warning text-white hover:bg-warning/90"
                >
                  {submitting ? 'Se salvează...' : 'Da, modifică'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setConfirming(false)}
                >
                  Nu, anulează
                </Button>
              </div>
            </div>
          ) : null}

          {error && (
            <div className="rounded-[10px] border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {!confirming ? (
          <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-5 py-4">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Anulează
            </Button>
            <Button size="sm" disabled={!selectedProduct} onClick={() => setConfirming(true)}>
              Continuă
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface SubstituteButtonProps {
  orderId: string;
  item: OrderItemInfo;
}

export function SubstituteButton({ orderId, item }: SubstituteButtonProps): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        title="Modifică articolul"
        onClick={() => setOpen(true)}
        className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition-colors"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {open ? (
        <SubstituteItemDialog orderId={orderId} item={item} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
