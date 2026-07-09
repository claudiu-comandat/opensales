'use client';

import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

interface OrderSyncButtonProps {
  /** API path fără query string — ex: '/orders/sync/trendyol' */
  syncPath: string;
  /** Numele marketplace-ului afișat în mesaje */
  label: string;
}

type SyncMode = 'all' | 'recent';

export function OrderSyncButton({ syncPath, label }: OrderSyncButtonProps): ReactElement {
  const [busy, setBusy] = useState<SyncMode | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSync(mode: SyncMode): Promise<void> {
    setBusy(mode);
    setMessage(null);
    try {
      const path = mode === 'recent' ? `${syncPath}?days=14` : `${syncPath}?days=90`;
      await getApiClient().post<{ ok: boolean }>(path, {});
      setMessage({
        kind: 'ok',
        text:
          mode === 'recent'
            ? 'Sync pornit pentru ultimele 14 zile. Comenzile vor apărea în câteva secunde.'
            : `Sync pornit pentru toate comenzile ${label}. Poate dura câteva minute.`,
      });
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Eroare la pornirea sync-ului.';
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sync-ul rulează automat la fiecare oră. Folosește butoanele de mai jos pentru a forța o
        rulare acum:
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void handleSync('recent');
          }}
          disabled={busy !== null}
        >
          {busy === 'recent' ? 'Se pornește...' : 'Sincronizează ultimele 14 zile'}
        </Button>
        <Button
          type="button"
          onClick={() => {
            void handleSync('all');
          }}
          disabled={busy !== null}
        >
          {busy === 'all' ? 'Se pornește...' : 'Sincronizează toate comenzile'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ultimele 14 zile aduce doar comenzile modificate recent. Toate comenzile parcurge tot
        istoricul disponibil pe {label}.
      </p>
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={
            message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-green-700'
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
