'use client';

import { useRef, useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StartResponse {
  jobId: string;
  totalProducts: number;
  totalPages: number;
}

type JobStatus = 'queued' | 'running' | 'done' | 'error';

interface ImportError {
  offer_id: string | number;
  message: string;
}

interface StatusResponse {
  jobId: string;
  status: JobStatus;
  currentPage: number;
  totalPages: number;
  productsImported: number;
  listingsImported: number;
  skipped: number;
  errors: ImportError[];
  startedAt: string;
  finishedAt?: string;
}

interface PreviewItem {
  raw: unknown;
  mapped: {
    sku: string;
    name: string;
    priceAmountMinor: string;
    priceCurrency: string;
    stockQuantity: number;
    brand: string | null;
    ean: string | null;
    vatRate: number | null;
    imagesCount: number;
  };
  existing: { id: string; sku: string; name: string } | null;
  action: 'create_product_and_listing' | 'link_to_existing';
}

interface PreviewResult {
  totalElements: number;
  items: PreviewItem[];
}

interface DebugRecord {
  storefront: string;
  approved: boolean;
  contentId: number | null;
  productMainId: string | null;
  barcode: string | null;
  outcome: 'imported' | 'ignored' | 'invalid';
}

interface DebugReport {
  totalRecords: number;
  byStorefront: Record<
    string,
    { seen: number; imported: number; ignored: number; invalid: number }
  >;
  distinctContentIds: number;
  crossStorefrontContentIds: number;
  records: DebugRecord[];
}

type Step = 'idle' | 'starting' | 'running' | 'done' | 'error';

interface TrendyolImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const POLL_INTERVAL_MS = 2000;

// ── Component ──────────────────────────────────────────────────────────────────

export function TrendyolImportDialog({
  open,
  onClose,
  onSuccess,
}: TrendyolImportDialogProps): ReactElement | null {
  const [step, setStep] = useState<Step>('idle');
  const [start, setStart] = useState<StartResponse | null>(null);
  const [progress, setProgress] = useState<StatusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [debug, setDebug] = useState<DebugReport | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successFiredRef = useRef(false);

  function stopPolling(): void {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function startPolling(jobId: string): void {
    stopPolling();
    async function tick(): Promise<void> {
      try {
        const res = await getApiClient().get<StatusResponse>(`/import/trendyol/status/${jobId}`);
        setProgress(res);
        if (res.status === 'done') {
          stopPolling();
          setStep('done');
          if (!successFiredRef.current) {
            successFiredRef.current = true;
            onSuccess();
          }
        } else if (res.status === 'error') {
          stopPolling();
          setStep('error');
          setErrorMsg(res.errors[0]?.message ?? 'Importul a eșuat.');
        }
      } catch (err) {
        stopPolling();
        const msg = err instanceof Error ? err.message : 'Eroare la verificarea statusului.';
        setErrorMsg(msg);
        setStep('error');
      }
    }
    void tick();
    pollTimerRef.current = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
  }

  async function handleStartImport(): Promise<void> {
    setStep('starting');
    setErrorMsg(null);
    setStart(null);
    setProgress(null);
    successFiredRef.current = false;

    try {
      const res = await getApiClient().post<StartResponse>('/import/trendyol/start', {});
      setStart(res);
      setStep('running');
      startPolling(res.jobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nu am putut porni importul.';
      setErrorMsg(msg);
      setStep('error');
    }
  }

  async function handlePreview(): Promise<void> {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await getApiClient().get<PreviewResult>('/import/trendyol/preview');
      setPreview(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nu am putut încărca preview-ul.';
      setErrorMsg(msg);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleLoadDebug(): Promise<void> {
    const jobId = progress?.jobId ?? start?.jobId;
    if (!jobId) return;
    setDebugLoading(true);
    try {
      const res = await getApiClient().get<DebugReport>(`/import/trendyol/debug/${jobId}`);
      setDebug(res);
    } catch {
      // best-effort debug; ignore failures
    } finally {
      setDebugLoading(false);
    }
  }

  function handleDownloadDebug(): void {
    if (!debug) return;
    const blob = new Blob([JSON.stringify(debug, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trendyol-import-debug-${progress?.jobId ?? start?.jobId ?? 'report'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleClose(): void {
    stopPolling();
    setStep('idle');
    setStart(null);
    setProgress(null);
    setErrorMsg(null);
    setPreview(null);
    setDebug(null);
    successFiredRef.current = false;
    onClose();
  }

  if (!open) return null;

  const isBlocking = step === 'starting' || step === 'running';
  const isFinal = step === 'done' || step === 'error';
  const isIdle = step === 'idle';

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target !== e.currentTarget) return;
    if (isBlocking) return;
    handleClose();
  }

  const totalPages = progress?.totalPages ?? start?.totalPages ?? 0;
  const currentPage = progress?.currentPage ?? 0;
  const productsImported = progress?.productsImported ?? 0;
  const listingsImported = progress?.listingsImported ?? 0;
  const percent = totalPages > 0 ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trendyol-import-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-[20px] border border-ink-200 bg-surface shadow-os-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
          <div>
            <h2 id="trendyol-import-title" className="text-[16px] font-semibold text-ink-900">
              Import produse din Trendyol
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Sincronizează catalogul tău de produse direct din contul Trendyol conectat.
            </p>
          </div>
          {!isBlocking && (
            <button
              type="button"
              onClick={handleClose}
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
          )}
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Idle state — action buttons */}
          {isIdle && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handlePreview()}
                  disabled={previewLoading}
                >
                  {previewLoading ? (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="animate-spin"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Se încarcă...
                    </span>
                  ) : (
                    'Preview produs'
                  )}
                </Button>
                <Button type="button" size="sm" onClick={() => void handleStartImport()}>
                  Pornește importul
                </Button>
              </div>

              {/* Preview card */}
              {preview && (
                <div className="rounded-[12px] border border-ink-200 bg-ink-50 text-[12.5px]">
                  <div className="border-b border-ink-100 px-4 py-2.5">
                    <p className="font-semibold text-ink-700">
                      Preview —{' '}
                      <span className="text-brand-600">{preview.items.length} produse</span>{' '}
                      eșantion aleatoriu din{' '}
                      <span className="font-mono">{preview.totalElements}</span> total
                    </p>
                  </div>

                  <div className="max-h-80 divide-y divide-ink-100 overflow-y-auto">
                    {preview.items.map((item, idx) => (
                      <div key={idx} className="px-4 py-3">
                        {/* Row header: SKU + action badge */}
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="font-mono text-[12px] font-semibold text-ink-900 truncate">
                            {item.mapped.sku}
                          </span>
                          {item.action === 'link_to_existing' ? (
                            <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                              ✓ Match
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full border border-ink-200 bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
                              — Ignorat
                            </span>
                          )}
                        </div>

                        {/* Product details grid */}
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                          <span className="text-ink-500">Nume</span>
                          <span className="truncate text-ink-900">{item.mapped.name}</span>
                          <span className="text-ink-500">Preț</span>
                          <span className="text-ink-900">
                            {(Number(item.mapped.priceAmountMinor) / 100).toFixed(2)}{' '}
                            {item.mapped.priceCurrency}
                          </span>
                          <span className="text-ink-500">Stoc</span>
                          <span className="text-ink-900">{item.mapped.stockQuantity}</span>
                          {item.mapped.brand && (
                            <>
                              <span className="text-ink-500">Brand</span>
                              <span className="text-ink-900">{item.mapped.brand}</span>
                            </>
                          )}
                        </div>

                        {/* Raw data expandable per item */}
                        <details className="mt-1.5">
                          <summary className="cursor-pointer select-none text-[11px] text-ink-400 hover:text-ink-600">
                            Date brute
                          </summary>
                          <pre className="mt-1 max-h-36 overflow-auto rounded-[6px] border border-ink-100 bg-white p-2 text-[10.5px] leading-relaxed text-ink-700">
                            {JSON.stringify(item.raw, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {errorMsg && (
                <p role="alert" className="text-[12.5px] text-danger">
                  {errorMsg}
                </p>
              )}
            </div>
          )}

          {/* Import progress */}
          {!isIdle && (
            <ol className="space-y-2.5">
              <StepRow
                label="Verific configurarea plugin-ului Trendyol..."
                state={step === 'starting' ? 'running' : 'done'}
              />
              <StepRow
                label={
                  start
                    ? `Număr produse de importat: ${start.totalProducts}`
                    : 'Calculez numărul de produse...'
                }
                state={
                  step === 'starting'
                    ? 'pending'
                    : step === 'running' || step === 'done' || step === 'error'
                      ? 'done'
                      : 'pending'
                }
              />
              <StepRow
                label={
                  step === 'running'
                    ? `Pagina ${currentPage} din ${totalPages} — ${productsImported} produse importate`
                    : step === 'done'
                      ? `${productsImported} produse importate (${totalPages} pagini)`
                      : 'În așteptare paginare...'
                }
                state={
                  step === 'running'
                    ? 'running'
                    : step === 'done'
                      ? 'done'
                      : step === 'error' && progress
                        ? 'error'
                        : 'pending'
                }
              />
            </ol>
          )}

          {(step === 'running' || step === 'done') && totalPages > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-ink-500">
                  {step === 'running' ? 'Se importă...' : 'Finalizat'}
                </span>
                <span className="text-[12px] font-semibold tabular-nums text-ink-700">
                  {percent}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="rounded-[12px] border border-success/30 bg-success/10 px-4 py-3">
              <p className="text-[13px] font-semibold text-success">Import finalizat cu succes</p>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                <span className="text-ink-500">Produse importate</span>
                <span className="font-semibold tabular-nums text-ink-900">{productsImported}</span>
                <span className="text-ink-500">Listing-uri importate</span>
                <span className="font-semibold tabular-nums text-ink-900">{listingsImported}</span>
                <span className="text-ink-500">Fără corespondent (ignorate)</span>
                <span className="font-semibold tabular-nums text-ink-500">
                  {progress?.skipped ?? 0}
                </span>
              </div>
            </div>
          )}

          {/* Raport debug */}
          {step === 'done' && (
            <div className="rounded-[12px] border border-ink-200 bg-ink-50 px-4 py-3">
              {!debug ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={debugLoading}
                  onClick={() => void handleLoadDebug()}
                >
                  {debugLoading ? 'Se încarcă...' : 'Raport debug'}
                </Button>
              ) : (
                <div className="space-y-2 text-[12px]">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink-700">Raport debug</p>
                    <Button type="button" variant="outline" size="sm" onClick={handleDownloadDebug}>
                      Descarcă JSON complet
                    </Button>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-0.5">
                    <span className="font-semibold text-ink-500">Țară</span>
                    <span className="font-semibold text-ink-500">Văzute</span>
                    <span className="font-semibold text-ink-500">Importate</span>
                    <span className="font-semibold text-ink-500">Ignorate</span>
                    <span className="font-semibold text-ink-500">Invalide</span>
                    {Object.entries(debug.byStorefront).map(([sf, c]) => (
                      <div key={sf} className="contents">
                        <span className="font-mono text-ink-900">{sf}</span>
                        <span className="text-ink-900">{c.seen}</span>
                        <span className="text-ink-900">{c.imported}</span>
                        <span className="text-ink-900">{c.ignored}</span>
                        <span className="text-ink-900">{c.invalid}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-ink-100 pt-2 text-ink-600">
                    Total înregistrări: <strong>{debug.totalRecords}</strong> · contentId distincte:{' '}
                    <strong>{debug.distinctContentIds}</strong>
                  </div>
                  {debug.crossStorefrontContentIds > 0 && (
                    <p className="text-danger">
                      ⚠ {debug.crossStorefrontContentIds} contentId apar pe mai multe țări — acestea
                      se suprascriu reciproc (cheia listing-ului e doar contentId). Asta explică de
                      ce listing-urile importate &gt; cele afișate.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-2 rounded-[12px] border border-danger/30 bg-danger/10 px-4 py-3">
              <p role="alert" className="text-[13px] font-semibold text-danger">
                Importul a eșuat
              </p>
              {errorMsg !== null && <p className="text-[12.5px] text-danger">{errorMsg}</p>}
              {progress && progress.errors.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-[12px] text-danger">
                    {progress.errors.length} erori detaliate
                  </summary>
                  <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto pl-1">
                    {progress.errors.map((e, i) => (
                      <li key={i} className="text-[11.5px] text-ink-700">
                        <span className="font-mono">#{String(e.offer_id)}</span> — {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {isFinal && (
              <Button type="button" size="sm" onClick={handleClose}>
                Închide
              </Button>
            )}
            {isBlocking && (
              <span className="text-[12px] text-ink-500">
                Te rugăm așteaptă, nu închide această fereastră.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step row ───────────────────────────────────────────────────────────────────

type StepState = 'pending' | 'running' | 'done' | 'error';

interface StepRowProps {
  label: string;
  state: StepState;
}

function StepRow({ label, state }: StepRowProps): ReactElement {
  let icon: ReactElement;
  let textClass = 'text-ink-700';

  if (state === 'done') {
    icon = (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-success"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  } else if (state === 'running') {
    icon = (
      <svg
        className="animate-spin text-brand-500"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  } else if (state === 'error') {
    icon = (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="text-danger"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
    textClass = 'text-danger';
  } else {
    icon = (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        className="text-ink-300"
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    );
    textClass = 'text-ink-400';
  }

  return (
    <li className="flex items-center gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className={`text-[13px] ${textClass}`}>{label}</span>
    </li>
  );
}
