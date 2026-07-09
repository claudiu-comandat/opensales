'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { MarketplaceInfo } from '@/lib/marketplace-catalog';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export interface TrendyolSecretField {
  name: string;
  label?: string;
  type?: 'string' | 'number' | 'password';
  required?: boolean;
}

export interface TrendyolConfigFormProps {
  pluginId: string;
  secretFields: TrendyolSecretField[];
  supported: MarketplaceInfo[];
  initialConfig: Record<string, unknown>;
}

type SeriesMode = 'single' | 'per_country';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Single-submit configuration for the Trendyol plugin: credentials, active
 * storefronts, the "Easy Cross Country" toggle and invoice series (one for all
 * or one per country) are all saved in a single POST /plugins/:id/configure
 * call (secrets + config together).
 */
export function TrendyolConfigForm({
  pluginId,
  secretFields,
  supported,
  initialConfig,
}: TrendyolConfigFormProps): ReactElement {
  const router = useRouter();

  const initialEnabled = Array.isArray(initialConfig.enabledMarketplaces)
    ? (initialConfig.enabledMarketplaces as string[])
    : [];
  const initialSeriesByMp =
    initialConfig.invoiceSeriesByMarketplace &&
    typeof initialConfig.invoiceSeriesByMarketplace === 'object'
      ? (initialConfig.invoiceSeriesByMarketplace as Record<string, string>)
      : {};

  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<string[]>(initialEnabled);
  const [easyCrossCountry, setEasyCrossCountry] = useState<boolean>(
    initialConfig.trendyolEasyCrossCountry === true,
  );
  const [seriesMode, setSeriesMode] = useState<SeriesMode>(
    initialConfig.invoiceSeriesMode === 'per_country' ? 'per_country' : 'single',
  );
  const [seriesSingle, setSeriesSingle] = useState<string>(asString(initialConfig.invoiceSeries));
  const [seriesByMp, setSeriesByMp] = useState<Record<string, string>>(initialSeriesByMp);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busyPush, setBusyPush] = useState(false);
  const [pushMessage, setPushMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  function toggleMarketplace(code: string): void {
    setEnabled((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function handlePushAll(): Promise<void> {
    setBusyPush(true);
    setPushMessage(null);
    try {
      const res = await getApiClient().post<{ ok: boolean; queued: number }>(
        `/import/trendyol/${pluginId}/push-all`,
        {},
      );
      setPushMessage({
        kind: 'ok',
        text: `Push pornit pentru ${res.queued} oferte.`,
      });
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Eroare la push.';
      setPushMessage({ kind: 'error', text });
    } finally {
      setBusyPush(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    setBusy(true);
    setMessage(null);

    // Only send credentials that were actually filled in (blank = keep current).
    const secretsPayload: Record<string, unknown> = {};
    for (const f of secretFields) {
      const raw = (secrets[f.name] ?? '').trim();
      if (raw.length > 0) secretsPayload[f.name] = raw;
    }

    const config: Record<string, unknown> = {
      enabledMarketplaces: enabled,
      trendyolEasyCrossCountry: easyCrossCountry,
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
      const body: { secrets?: Record<string, unknown>; config: Record<string, unknown> } = {
        config,
      };
      if (Object.keys(secretsPayload).length > 0) body.secrets = secretsPayload;
      await getApiClient().post(`/plugins/${pluginId}/configure`, body);
      setMessage({ kind: 'ok', text: 'Configurație salvată.' });
      setSecrets({});
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
      data-testid="trendyol-config-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      {/* Credențiale */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Credențiale</legend>
        <p className="text-xs text-muted-foreground">
          Lasă un câmp gol pentru a păstra valoarea curentă.
        </p>
        {secretFields.map((f) => {
          const inputId = `ty-secret-${f.name}`;
          const inputType =
            f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text';
          return (
            <div key={f.name} className="space-y-1">
              <label htmlFor={inputId} className="block text-sm font-medium">
                {f.label ?? f.name}
                {f.required && <span className="text-destructive"> *</span>}
              </label>
              <input
                id={inputId}
                type={inputType}
                autoComplete="off"
                value={secrets[f.name] ?? ''}
                onChange={(e) => setSecrets((p) => ({ ...p, [f.name]: e.target.value }))}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          );
        })}
      </fieldset>

      {/* Țări active */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Țări active</legend>
        <div className="grid grid-cols-2 gap-2">
          {supported.map((m) => (
            <label key={m.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled.includes(m.code)}
                onChange={() => toggleMarketplace(m.code)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Easy Cross Country */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Sincronizare Trendyol</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={easyCrossCountry}
            onChange={(e) => setEasyCrossCountry(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Am activat „Easy Cross Country" în Trendyol
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Dacă e bifat, doar ofertele din țara de origine (RO) sunt editabile; celelalte țări
              devin read-only (sincronizate din RO). Dacă nu, toate țările sunt editabile.
            </span>
          </span>
        </label>
      </fieldset>

      {/* Serie facturare */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Serie facturare</legend>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="ty-series-mode"
              checked={seriesMode === 'single'}
              onChange={() => setSeriesMode('single')}
            />
            O serie pentru toate țările
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="ty-series-mode"
              checked={seriesMode === 'per_country'}
              onChange={() => setSeriesMode('per_country')}
            />
            Serie per țară
          </label>
        </div>
        {seriesMode === 'single' ? (
          <input
            type="text"
            placeholder="Ex: TY"
            value={seriesSingle}
            onChange={(e) => setSeriesSingle(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        ) : (
          <div className="space-y-2">
            {enabled.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Selectează cel puțin o țară pentru a configura seriile.
              </p>
            ) : (
              enabled.map((code) => {
                const label = supported.find((m) => m.code === code)?.label ?? code;
                return (
                  <div key={code} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-sm">{label}</span>
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

      <div className="border-t pt-4">
        {pushMessage && (
          <p
            role={pushMessage.kind === 'error' ? 'alert' : 'status'}
            className={
              pushMessage.kind === 'error'
                ? 'mb-3 text-sm text-destructive'
                : 'mb-3 text-sm text-green-700'
            }
          >
            {pushMessage.text}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busyPush}
          onClick={() => void handlePushAll()}
        >
          {busyPush ? 'Se trimite…' : 'Retrimite toate ofertele'}
        </Button>
      </div>
    </form>
  );
}
