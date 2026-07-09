'use client';

import { useRef, useState } from 'react';

import type { ChangeEvent, FormEvent, ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ImportResult {
  productsCreated: number;
  productsUpdated: number;
  listingsCreated: number;
  listingsSkipped: number;
  errors: string[];
}

interface EasysalesImportDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}

const CURRENCIES = [
  { value: 'RON', label: 'RON — Leu românesc' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'BGN', label: 'BGN — Leva bulgărească' },
  { value: 'HUF', label: 'HUF — Forint maghiar' },
  { value: 'USD', label: 'USD — Dolar american' },
  { value: 'GBP', label: 'GBP — Liră sterlină' },
];

// ── Component ──────────────────────────────────────────────────────────────────

export function EasysalesImportDialog({
  onClose,
  onSuccess,
}: EasysalesImportDialogProps): ReactElement {
  const [productsFile, setProductsFile] = useState<File | null>(null);
  const [offersFiles, setOffersFiles] = useState<File[]>([]);
  const [currency, setCurrency] = useState('RON');

  // Upload / prepare state (file → server parse → sessionId)
  const [preparing, setPreparing] = useState(false);

  // Commit / progress state
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const productsRef = useRef<HTMLInputElement>(null);
  const offersRef = useRef<HTMLInputElement>(null);

  // Generation counter — incremented each time files change so stale
  // prepare responses are silently discarded when the file is replaced.
  const prepareGenRef = useRef(0);

  // Set when the user clicks Import before prepare has finished.
  // triggerPrepare will call doCommit automatically when sessionId arrives.
  const pendingCommitRef = useRef(false);

  // Current staged session — ref only (not needed for rendering)
  const sessionIdRef = useRef<string | null>(null);

  // Currency ref — kept in sync every render so async doCommit reads the
  // latest value even when called from inside triggerPrepare's closure.
  const currencyRef = useRef(currency);
  currencyRef.current = currency;

  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Progress animation ────────────────────────────────────────────────────────

  function startProgressAnimation(): void {
    setProgress(0);
    let cur = 0;
    progressTimerRef.current = setInterval(() => {
      cur += Math.random() * 3 + 0.5;
      if (cur >= 85) {
        cur = 85;
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      }
      setProgress(Math.round(cur));
    }, 60);
  }

  function finishProgress(): void {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setProgress(100);
  }

  // ── Commit ────────────────────────────────────────────────────────────────────

  async function doCommit(sid: string): Promise<void> {
    try {
      const data = await getApiClient().post<ImportResult>('/import/easysales/commit', {
        sessionId: sid,
        currency: currencyRef.current,
      });
      finishProgress();
      setResult(data);
      onSuccess();
    } catch (err) {
      finishProgress();
      setError(err instanceof Error ? err.message : 'Eroare la import.');
    } finally {
      setLoading(false);
    }
  }

  // ── Prepare (upload + server-side parse) ──────────────────────────────────────

  async function triggerPrepare(pFile: File | null, oFiles: File[]): Promise<void> {
    sessionIdRef.current = null;
    if (!pFile) return;

    const gen = ++prepareGenRef.current;
    setPreparing(true);

    try {
      const form = new FormData();
      form.append('products', pFile);
      for (const f of oFiles) form.append('offers', f);

      const { sessionId } = await getApiClient().postForm<{ sessionId: string }>(
        '/import/easysales/prepare',
        form,
      );

      if (prepareGenRef.current !== gen) return; // file was replaced while uploading

      sessionIdRef.current = sessionId;

      // If user already clicked Import while we were preparing, commit now
      if (pendingCommitRef.current) {
        pendingCommitRef.current = false;
        void doCommit(sessionId);
      }
    } catch (err) {
      if (prepareGenRef.current !== gen) return;
      const msg = err instanceof Error ? err.message : 'Eroare la pregătire.';
      setError(msg);
      // Prepare failed while commit was pending — cancel the loading state
      if (pendingCommitRef.current) {
        pendingCommitRef.current = false;
        finishProgress();
        setLoading(false);
      }
    } finally {
      if (prepareGenRef.current === gen) setPreparing(false);
    }
  }

  // ── Reset helpers ─────────────────────────────────────────────────────────────

  function resetImportState(): void {
    sessionIdRef.current = null;
    pendingCommitRef.current = false;
    setResult(null);
    setError(null);
    setProgress(0);
    setLoading(false);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  // ── File handlers ─────────────────────────────────────────────────────────────

  function handleProductsChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] ?? null;
    setProductsFile(file);
    resetImportState();
    void triggerPrepare(file, offersFiles);
  }

  function handleOffersChange(e: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    setOffersFiles(files);
    if (productsFile) {
      resetImportState();
      void triggerPrepare(productsFile, files);
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  function handleImportClick(e: FormEvent): void {
    e.preventDefault();
    if (!productsFile || loading) return;

    startProgressAnimation();
    setLoading(true);
    setError(null);

    if (sessionIdRef.current) {
      // Prepare already done — commit immediately
      void doCommit(sessionIdRef.current);
    } else {
      // Still uploading — mark pending; doCommit fires when sessionId arrives
      pendingCommitRef.current = true;
    }
  }

  const hasResult = result !== null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e): void => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="w-full max-w-lg rounded-[20px] border border-ink-200 bg-surface shadow-os-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-ink-900">Import din EasySales</h2>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Importă produse și oferte din exportul EasySales (.xlsx)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleImportClick} className="space-y-4 px-6 py-5">
          {/* Products file */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-ink-700">
              Export Produse <span className="text-danger">*</span>
            </label>
            <p className="text-[11.5px] text-ink-500">
              Fișierul „Produse" exportat din EasySales (format .xlsx)
            </p>
            <div
              className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-ink-300 bg-ink-50 px-4 py-3 transition hover:border-brand-400 hover:bg-brand-50"
              onClick={(): void => productsRef.current?.click()}
            >
              {preparing ? (
                <svg
                  className="shrink-0 animate-spin text-brand-500"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-ink-400"
                  aria-hidden="true"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
              )}
              <span className="flex-1 text-[13px] text-ink-600">
                {productsFile ? productsFile.name : 'Alege fișier produse…'}
              </span>
              <input
                ref={productsRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleProductsChange}
              />
            </div>
          </div>

          {/* Offers files */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-ink-700">
              Export Oferte <span className="text-[11px] font-normal text-ink-400">(opțional)</span>
            </label>
            <p className="text-[11.5px] text-ink-500">
              Fișierele de oferte eMAG, Trendyol, Temu — poți selecta mai multe
            </p>
            <div
              className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-dashed border-ink-300 bg-ink-50 px-4 py-3 transition hover:border-brand-400 hover:bg-brand-50"
              onClick={(): void => offersRef.current?.click()}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-ink-400"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <span className="flex-1 text-[13px] text-ink-600">
                {offersFiles.length > 0
                  ? `${offersFiles.length} fișier${offersFiles.length > 1 ? 'e' : ''} selectat${offersFiles.length > 1 ? 'e' : ''}`
                  : 'Alege fișiere oferte…'}
              </span>
              <input
                ref={offersRef}
                type="file"
                accept=".xlsx,.xls"
                multiple
                className="hidden"
                onChange={handleOffersChange}
              />
            </div>
            {offersFiles.length > 0 && (
              <ul className="space-y-0.5 pl-1">
                {offersFiles.map((f) => (
                  <li key={f.name} className="text-[11.5px] text-ink-500">
                    • {f.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Currency */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-ink-700">Monedă produse</label>
            <select
              value={currency}
              onChange={(e): void => setCurrency(e.target.value)}
              className="h-9 w-full rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Progress bar — visible while import is running */}
          {(loading || (progress > 0 && !hasResult)) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-ink-500">
                  {loading ? 'Se importă…' : 'Pregătit de import'}
                </span>
                <span className="text-[12px] font-semibold tabular-nums text-ink-700">
                  {progress}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error !== null && (
            <p
              role="alert"
              className="rounded-[10px] bg-danger/10 px-3 py-2.5 text-[12.5px] text-danger"
            >
              {error}
            </p>
          )}

          {/* Result */}
          {hasResult && (
            <div className="space-y-2 rounded-[12px] border border-ink-200 bg-ink-50 px-4 py-3">
              <p className="text-[13px] font-semibold text-ink-800">Import finalizat</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                <span className="text-ink-500">Produse create</span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {result.productsCreated}
                </span>
                <span className="text-ink-500">Produse actualizate</span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {result.productsUpdated}
                </span>
                <span className="text-ink-500">Listări create</span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {result.listingsCreated}
                </span>
                <span className="text-ink-500">Listări ignorate</span>
                <span className="font-semibold tabular-nums text-ink-500">
                  {result.listingsSkipped}
                </span>
              </div>
              {result.errors.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[12px] text-warning">
                    {result.errors.length} avertisment{result.errors.length > 1 ? 'e' : ''}
                  </summary>
                  <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto pl-1">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-[11.5px] text-ink-600">
                        • {e}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
              {hasResult ? 'Închide' : 'Anulează'}
            </Button>
            {!hasResult && (
              <Button type="submit" size="sm" disabled={!productsFile || loading}>
                {loading ? 'Se importă…' : 'Importă'}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
