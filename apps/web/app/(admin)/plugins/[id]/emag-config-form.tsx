'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MarketplaceInfo } from '@/lib/marketplace-catalog';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export interface EmagConfigFormProps {
  pluginId: string;
  supported: MarketplaceInfo[];
  initialConfig: Record<string, unknown>;
}

type SeriesMode = 'single' | 'per_country';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function EmagConfigForm({
  pluginId,
  supported,
  initialConfig,
}: EmagConfigFormProps): ReactElement {
  const router = useRouter();

  const initialEnabled = Array.isArray(initialConfig.enabledMarketplaces)
    ? (initialConfig.enabledMarketplaces as string[])
    : [];
  const initialSeriesByMp =
    initialConfig.invoiceSeriesByMarketplace &&
    typeof initialConfig.invoiceSeriesByMarketplace === 'object'
      ? (initialConfig.invoiceSeriesByMarketplace as Record<string, string>)
      : {};

  const [enabled, setEnabled] = useState<string[]>(initialEnabled);
  const [seriesMode, setSeriesMode] = useState<SeriesMode>(
    initialConfig.invoiceSeriesMode === 'per_country' ? 'per_country' : 'single',
  );
  const [seriesSingle, setSeriesSingle] = useState<string>(asString(initialConfig.invoiceSeries));
  const [seriesByMp, setSeriesByMp] = useState<Record<string, string>>(initialSeriesByMp);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function toggleMarketplace(code: string): void {
    setEnabled((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handleSubmit(): Promise<void> {
    setBusy(true);
    setMessage(null);

    const config: Record<string, unknown> = {
      enabledMarketplaces: enabled,
      invoiceSeriesMode: seriesMode,
    };
    if (seriesMode === 'single') {
      config.invoiceSeries = seriesSingle.trim();
    } else {
      const map: Record<string, string> = {};
      for (const code of enabled) {
        const v = (seriesByMp[code] ?? '').trim();
        if (v.length > 0) map[code] = v;
      }
      config.invoiceSeriesByMarketplace = map;
    }

    try {
      await getApiClient().post(`/plugins/${pluginId}/configure`, { config });
      setMessage({ kind: 'ok', text: 'Configurație salvată.' });
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
      className="space-y-6"
      data-testid="emag-config-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      {/* Marketplace-uri active */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Marketplace-uri active</legend>
        <p className="text-xs text-muted-foreground">
          Bifează țările pe care vrei să le poți folosi din acest plugin. Ofertele către un
          marketplace nebifat sunt ignorate la import.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {supported.map((m) => (
            <label key={m.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled.includes(m.code)}
                onChange={() => toggleMarketplace(m.code)}
              />
              <span>{m.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{m.code}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Serie facturare */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Serie facturare</legend>
        <p className="text-xs text-muted-foreground">
          Seria folosită de FGO la emiterea facturilor pentru comenzile din acest plugin.
        </p>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="emag-series-mode"
              checked={seriesMode === 'single'}
              onChange={() => setSeriesMode('single')}
            />
            O serie pentru toate țările
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="emag-series-mode"
              checked={seriesMode === 'per_country'}
              onChange={() => setSeriesMode('per_country')}
            />
            Serie per țară
          </label>
        </div>
        {seriesMode === 'single' ? (
          <input
            type="text"
            placeholder="Ex: EMG"
            value={seriesSingle}
            onChange={(e) => setSeriesSingle(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        ) : (
          <div className="space-y-2">
            {enabled.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Selectează cel puțin un marketplace pentru a configura seriile.
              </p>
            ) : (
              enabled.map((code) => {
                const label = supported.find((m) => m.code === code)?.label ?? code;
                return (
                  <div key={code} className="flex items-center gap-2">
                    <span className="w-48 shrink-0 text-sm">{label}</span>
                    <input
                      type="text"
                      placeholder="Serie"
                      value={seriesByMp[code] ?? ''}
                      onChange={(e) => setSeriesByMp((p) => ({ ...p, [code]: e.target.value }))}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                  </div>
                );
              })
            )}
          </div>
        )}
      </fieldset>

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
        {busy ? 'Se salvează…' : 'Salvează configurație'}
      </Button>
    </form>
  );
}
