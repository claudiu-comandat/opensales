'use client';

import { useEffect, useRef, useState } from 'react';

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
  errors: ImportError[];
  startedAt: string;
  finishedAt?: string;
}

type Step = 'idle' | 'starting' | 'running' | 'done' | 'error';

interface EmagImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const POLL_INTERVAL_MS = 2000;

// ── Component ──────────────────────────────────────────────────────────────────

export function EmagImportDialog({
  open,
  onClose,
  onSuccess,
}: EmagImportDialogProps): ReactElement | null {
  const [step, setStep] = useState<Step>('idle');
  const [start, setStart] = useState<StartResponse | null>(null);
  const [progress, setProgress] = useState<StatusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successFiredRef = useRef(false);

  // Begin the import as soon as the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function begin(): Promise<void> {
      setStep('starting');
      setErrorMsg(null);
      setStart(null);
      setProgress(null);
      successFiredRef.current = false;

      try {
        const res = await getApiClient().post<StartResponse>('/import/emag/start', {});
        if (cancelled) return;
        setStart(res);
        setStep('running');
        startPolling(res.jobId);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Nu am putut porni importul.';
        setErrorMsg(msg);
        setStep('error');
      }
    }

    void begin();

    return (): void => {
      cancelled = true;
      stopPolling();
    };
  }, [open]);

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
        const res = await getApiClient().get<StatusResponse>(`/import/emag/status/${jobId}`);
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

  if (!open) return null;

  const isBlocking = step === 'starting' || step === 'running';
  const isFinal = step === 'done' || step === 'error';

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target !== e.currentTarget) return;
    if (isBlocking) return;
    onClose();
  }

  const totalPages = progress?.totalPages ?? start?.totalPages ?? 0;
  const currentPage = progress?.currentPage ?? 0;
  const productsImported = progress?.productsImported ?? 0;
  const listingsImported = progress?.listingsImported ?? 0;
  // eMAG's product_offer/count (noOfPages) is an unreliable estimate, so the
  // running ratio can never reach 100%. Once the job reports `done`, pin to 100%.
  const percent =
    step === 'done'
      ? 100
      : totalPages > 0
        ? Math.min(100, Math.round((currentPage / totalPages) * 100))
        : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emag-import-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-[20px] border border-ink-200 bg-surface shadow-os-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
          <div>
            <h2 id="emag-import-title" className="text-[16px] font-semibold text-ink-900">
              Import produse din eMAG
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Sincronizează catalogul tău de produse direct din contul eMAG conectat.
            </p>
          </div>
          {!isBlocking && (
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
          )}
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          <ol className="space-y-2.5">
            <StepRow
              label="Verific configurarea plugin-ului eMAG..."
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
              </div>
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
              <Button type="button" size="sm" onClick={onClose}>
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
