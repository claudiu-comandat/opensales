'use client';

import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

interface BackfillResult {
  total: number;
  sent: number;
  skipped: number;
  errors: { orderId: string; message: string }[];
}

export function TrendyolInvoiceBackfillButton(): ReactElement {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: 'ok'; data: BackfillResult } | { kind: 'error'; text: string } | null
  >(null);

  async function handleBackfill(): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      const data = await getApiClient().post<BackfillResult>(
        '/debug/trendyol-backfill-invoices',
        {},
      );
      setResult({ kind: 'ok', data });
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Eroare la trimiterea facturilor.';
      setResult({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Retrimite link-urile facturilor emise din OpenSales la Trendyol. Comenzile care au deja
        factura atașată vor fi sărite automat (409).
      </p>
      <Button
        type="button"
        onClick={() => {
          void handleBackfill();
        }}
        disabled={busy}
      >
        {busy ? 'Se trimit facturile...' : 'Retrimite facturile la Trendyol'}
      </Button>
      {result?.kind === 'ok' && (
        <div role="status" className="space-y-1 text-sm">
          <p className="text-green-700">
            Finalizat: {result.data.sent} trimise, {result.data.skipped} sărite (deja atașate)
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
