'use client';

import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

export interface PickedProduct {
  id: string;
  sku: string;
  name: string;
  priceAmountMinor: number;
  priceCurrency: string;
  vatRate: number | null;
  ean: string | null;
}

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  ean: string | null;
  vatRate: number | null;
  price: { amountMinor: string; currency: string };
  isActive: boolean;
}

interface ApiResponse {
  data: ProductHit[];
  total: number;
}

interface ProductPickerModalProps {
  onSelect: (product: PickedProduct) => void;
  onClose: () => void;
}

export function ProductPickerModal({ onSelect, onClose }: ProductPickerModalProps): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getApiClient().get<ApiResponse>(
        `/products?search=${encodeURIComponent(trimmed)}&pageSize=30`,
      );
      setResults(res.data);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  function handleSelect(hit: ProductHit): void {
    onSelect({
      id: hit.id,
      sku: hit.sku,
      name: hit.name,
      priceAmountMinor: parseInt(hit.price.amountMinor, 10),
      priceCurrency: hit.price.currency,
      vatRate: hit.vatRate,
      ean: hit.ean,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-xl flex-col rounded-[18px] border border-ink-200 bg-surface shadow-os-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <span className="t-h3">Caută produs</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink-100"
          >
            <X className="h-4 w-4 text-ink-500" />
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caută după SKU, nume sau EAN…"
            className="flex-1 bg-transparent text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          {loading ? <span className="text-[11px] text-ink-400">Se caută…</span> : null}
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {results.length === 0 && searched && !loading ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-400">
              Niciun produs găsit pentru „{query}".
            </p>
          ) : null}
          {results.length === 0 && !searched && query.length < 2 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-400">
              Scrie cel puțin 2 caractere pentru a căuta.
            </p>
          ) : null}
          {results.map((hit) => {
            const price = parseInt(hit.price.amountMinor, 10) / 100;
            return (
              <button
                key={hit.id}
                type="button"
                onClick={() => handleSelect(hit)}
                className="flex w-full items-start gap-3 border-b border-ink-50 px-4 py-3 text-left last:border-0 hover:bg-ink-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-brand-600">
                      {hit.sku}
                    </span>
                    {hit.ean ? (
                      <span className="font-mono text-[10px] text-ink-400">EAN: {hit.ean}</span>
                    ) : null}
                    {!hit.isActive ? (
                      <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">
                        inactiv
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-ink-900">{hit.name}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[13px] font-semibold text-ink-900">
                    {price.toFixed(2)} {hit.price.currency}
                  </div>
                  {hit.vatRate !== null ? (
                    <div className="text-[11px] text-ink-400">TVA {hit.vatRate}%</div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-ink-100 px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Anulează
          </Button>
        </div>
      </div>
    </div>
  );
}
