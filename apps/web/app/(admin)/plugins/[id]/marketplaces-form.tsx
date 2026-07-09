'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MarketplaceInfo } from '@/lib/marketplace-catalog';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export interface MarketplacesFormProps {
  pluginId: string;
  supported: MarketplaceInfo[];
  initialEnabled: string[];
}

export function MarketplacesForm({
  pluginId,
  supported,
  initialEnabled,
}: MarketplacesFormProps): ReactElement {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initialEnabled));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const router = useRouter();

  function toggle(code: string): void {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleSubmit(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await getApiClient().post(`/plugins/${pluginId}/configure`, {
        config: { enabledMarketplaces: [...enabled] },
      });
      setMessage({ kind: 'ok', text: 'Marketplace-uri salvate.' });
      router.refresh();
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Eroare la salvare.';
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      data-testid="marketplaces-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Bifează țările pe care vrei să le poți folosi din acest plugin. Ofertele către un
        marketplace nebifat sunt ignorate la import.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {supported.map((m) => {
          const inputId = `mp-${m.code}`;
          return (
            <label key={m.code} htmlFor={inputId} className="flex items-center gap-2 text-sm">
              <input
                id={inputId}
                type="checkbox"
                checked={enabled.has(m.code)}
                onChange={() => toggle(m.code)}
              />
              <span>{m.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{m.code}</span>
            </label>
          );
        })}
      </div>
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
      <Button type="submit" disabled={busy}>
        {busy ? 'Se salvează…' : 'Salvează marketplace-uri'}
      </Button>
    </form>
  );
}
