'use client';

import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export function EmagValidationSyncButton(): ReactElement {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSync(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await getApiClient().post<{ ok: boolean }>('/import/emag/sync-validation', {});
      setMessage({
        kind: 'ok',
        text: 'Sincronizare pornita. Statusurile ofertelor vor fi actualizate in cateva secunde.',
      });
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Eroare la pornirea sincronizarii.';
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sincronizarea ruleaza automat la fiecare 2 ore. Apasa butonul pentru a forta o rulare acum.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          void handleSync();
        }}
      >
        {busy ? 'Se porneste...' : 'Sincronizeaza statusuri oferte'}
      </Button>
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
