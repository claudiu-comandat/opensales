'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { ReactElement } from 'react';

export interface ImportBatchSku {
  sku: string;
  status: 'created' | 'conflict' | 'rejected';
}

export interface ActiveImportBatch {
  batchId: string;
  status: 'processing' | 'completed' | 'failed';
  total: number;
  processed: number;
  results: ImportBatchSku[];
}

/**
 * Înlocuiește butonul „Importă din..." cât timp un lot import/products este în
 * procesare. Reîmprospătează periodic pagina (server component) ca să arate
 * progresul; când lotul se termină, indicatorul dispare și butonul revine.
 */
export function ImportBatchIndicator({ batch }: { batch: ActiveImportBatch }): ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Poll server-side progress while the batch is still processing.
  useEffect(() => {
    if (batch.status !== 'processing') return;
    const id = setInterval(() => {
      router.refresh();
    }, 4000);
    return (): void => clearInterval(id);
  }, [batch.status, batch.processed, router]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return (): void => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const created = batch.results.filter((r) => r.status === 'created').length;
  const conflict = batch.results.filter((r) => r.status === 'conflict').length;
  const rejected = batch.results.filter((r) => r.status === 'rejected').length;
  const pct = batch.total > 0 ? Math.round((batch.processed / batch.total) * 100) : 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(): void => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-[10px] border border-ink-200 bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-700 hover:bg-ink-50"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="animate-spin"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Se importă produse prin API
        <span className="font-mono text-[11.5px] text-ink-400">
          {batch.processed}/{batch.total}
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute right-0 z-40 mt-1 w-72 overflow-hidden rounded-[12px] border border-ink-200 bg-surface p-3 shadow-os-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink-900">Import în curs</span>
            <span className="font-mono text-[11.5px] text-ink-500">{pct}%</span>
          </div>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex flex-col gap-1 text-[12px] text-ink-600">
            <Row label="Procesate" value={`${batch.processed} / ${batch.total}`} />
            <Row label="Create" value={created} />
            <Row label="Conflict (existente)" value={conflict} />
            <Row label="Respinse" value={rejected} />
          </div>
          <div className="mt-2 truncate font-mono text-[10.5px] text-ink-400" title={batch.batchId}>
            batch: {batch.batchId}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }): ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-medium text-ink-900">{value}</span>
    </div>
  );
}
