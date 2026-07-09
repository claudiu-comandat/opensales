'use client';

import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

interface BackfillResult {
  total: number;
  filled: number;
  skipped: number;
  errors: { orderId: string; message: string }[];
}

export function TrendyolInvoiceRefsBackfillButton(): ReactElement {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: 'ok'; data: BackfillResult } | { kind: 'error'; text: string } | null
  >(null);

  async function handleBackfill(): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      const data = await getApiClient().post<BackfillResult>(
        '/debug/trendyol-backfill-invoice-refs',
        {},
      );
      setResult({ kind: 'ok', data });
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Eroare la completarea seriilor.';
      setResult({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Completează seria și numărul facturii (citite din PDF-ul FGO) pentru comenzile migrate care
        au doar link-ul. Cele care au deja număr sunt sărite. Necesar pentru stornare.
      </p>
      <Button
        type="button"
        onClick={() => {
          void handleBackfill();
        }}
        disabled={busy}
      >
        {busy ? 'Se completează...' : 'Completează serie/număr din PDF'}
      </Button>
      {result?.kind === 'ok' && (
        <div role="status" className="space-y-1 text-sm">
          <p className="text-green-700">
            Finalizat: {result.data.filled} completate, {result.data.skipped} sărite
            {result.data.errors.length > 0 && `, ${result.data.errors.length} erori`} din{' '}
            {result.data.total} total.
          </p>
          {result.data.errors.length > 0 && (
            <ul className="list-disc pl-4 text-destructive">
              {result.data.errors.map((e) => (
                <li key={e.orderId}>
                  {e.orderId}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.kind === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {result.text}
        </p>
      )}
    </div>
  );
}
