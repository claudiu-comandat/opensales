'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

const CANCELLABLE_STATUSES = new Set(['new', 'processing', 'packed']);

const EMAG_CANCEL_REASONS: { id: number; label: string }[] = [
  { id: 1, label: 'Stoc epuizat' },
  { id: 2, label: 'Anulat la cererea clientului' },
  { id: 3, label: 'Client necontactabil' },
  { id: 4, label: 'Imposibil de expediat' },
  { id: 5, label: 'Termen de plată expirat' },
];

const TRENDYOL_CANCEL_REASONS: { id: number; label: string }[] = [
  { id: 500, label: 'Stoc epuizat / întârziere livrare' },
  { id: 501, label: 'Produs defect / deteriorat' },
  { id: 502, label: 'Preț incorect' },
  { id: 503, label: 'Imagine / cod de bare / cantitate incorectă' },
  { id: 504, label: 'Eroare de integrare' },
  { id: 505, label: 'Achiziție în cantitate mare' },
  { id: 506, label: 'Forță majoră' },
];

function reasonsFor(marketplace: string | undefined): { id: number; label: string }[] {
  if (marketplace?.startsWith('emag-') || marketplace?.startsWith('fbe-'))
    return EMAG_CANCEL_REASONS;
  if (marketplace?.startsWith('trendyol-')) return TRENDYOL_CANCEL_REASONS;
  return [];
}

function cancelEndpoint(orderId: string, marketplace: string | undefined): string | null {
  if (marketplace?.startsWith('emag-') || marketplace?.startsWith('fbe-'))
    return `/orders/${orderId}/emag-cancel`;
  if (marketplace?.startsWith('trendyol-')) return `/orders/${orderId}/trendyol-cancel`;
  return null;
}

interface CancelOrderButtonProps {
  orderId: string;
  marketplace: string | undefined;
  status: string;
}

export function CancelOrderButton({
  orderId,
  marketplace,
  status,
}: CancelOrderButtonProps): ReactElement | null {
  const router = useRouter();
  const reasons = reasonsFor(marketplace);
  const endpoint = cancelEndpoint(orderId, marketplace);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState<number>(reasons[0]?.id ?? 0);

  if (!CANCELLABLE_STATUSES.has(status) || !endpoint || reasons.length === 0) return null;

  async function handleConfirm(): Promise<void> {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    try {
      await getApiClient().post(endpoint, { reasonId });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Eroare la anulare.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-destructive text-destructive hover:bg-destructive/10"
        onClick={(): void => setOpen(true)}
      >
        Anulează comanda
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e): void => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-ink-200 bg-surface p-5 shadow-os-md">
            <p className="text-[15px] font-semibold text-ink-900">Anulează comanda</p>
            <div className="space-y-1.5">
              <label className="block text-[12px] text-ink-600">Motiv anulare</label>
              <select
                value={reasonId}
                onChange={(e): void => setReasonId(Number(e.target.value))}
                className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {reasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(): void => setOpen(false)}
                disabled={busy}
              >
                Renunță
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={busy}
                onClick={(): void => {
                  void handleConfirm();
                }}
              >
                {busy ? 'Se anulează…' : 'Confirmă anularea'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
