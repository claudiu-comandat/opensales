'use client';

import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

type SyncMode = 'all' | 'recent';

export function EmagSyncButton(): ReactElement {
  const [busy, setBusy] = useState<SyncMode | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSync(mode: SyncMode): Promise<void> {
    setBusy(mode);
    setMessage(null);
    try {
      const path = mode === 'recent' ? '/orders/sync/emag?days=7' : '/orders/sync/emag';
      await getApiClient().post<{ ok: boolean }>(path, {});
      setMessage({
        kind: 'ok',
        text:
          mode === 'recent'
            ? 'Sync pornit pentru ultimele 7 zile. Comenzile vor aparea in cateva secunde.'
            : 'Sync pornit pentru toate comenzile. Poate dura cateva minute.',
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
        Sync-ul ruleaza automat la fiecare ora. Foloseste butoanele de mai jos pentru a forta o
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
          {busy === 'recent' ? 'Se porneste...' : 'Sincronizeaza ultimele 7 zile'}
        </Button>
        <Button
          type="button"
          onClick={() => {
            void handleSync('all');
          }}
          disabled={busy !== null}
        >
          {busy === 'all' ? 'Se porneste...' : 'Sincronizeaza toate comenzile'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ultimele 7 zile aduce doar comenzile modificate recent. Toate comenzile parcurge tot
        istoricul disponibil pe eMAG.
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
