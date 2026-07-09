'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export interface FgoSecretsFormProps {
  pluginId: string;
}

export function FgoSecretsForm({ pluginId }: FgoSecretsFormProps): ReactElement {
  const router = useRouter();
  const [codUnic, setCodUnic] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [environment, setEnvironment] = useState<'prod' | 'uat'>('prod');
  const [defaultSerie, setDefaultSerie] = useState('');
  const [platformUrl, setPlatformUrl] = useState('');
  const [autoEmit, setAutoEmit] = useState(false);
  const [verificareDuplicat, setVerificareDuplicat] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleSubmit(): Promise<void> {
    if (!codUnic.trim()) {
      setMessage({ kind: 'error', text: 'Cod Unic (CUI) este obligatoriu.' });
      return;
    }
    if (!privateKey.trim()) {
      setMessage({ kind: 'error', text: 'Private Key FGO este obligatoriu.' });
      return;
    }

    const secrets: Record<string, unknown> = {
      codUnic: codUnic.trim(),
      privateKey: privateKey.trim(),
      environment,
      autoEmitOnOrderCreated: autoEmit,
      verificareDuplicat,
    };
    if (defaultSerie.trim()) secrets.defaultSerie = defaultSerie.trim();
    if (platformUrl.trim()) secrets.platformUrl = platformUrl.trim();

    setBusy(true);
    setMessage(null);
    try {
      await getApiClient().post(`/plugins/${pluginId}/configure`, { secrets });
      setMessage({ kind: 'ok', text: 'Secrete salvate.' });
      setCodUnic('');
      setPrivateKey('');
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
      data-testid="fgo-secrets-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Secretele sunt stocate criptat în storage-ul pluginului. Lasă câmpul gol pentru a păstra
        valoarea curentă.
      </p>

      {/* ── Obligatorii ─────────────────────────────────────────── */}
      <div className="space-y-1">
        <label htmlFor="fgo-codUnic" className="block text-sm font-medium">
          Cod Unic (CUI) <span className="text-destructive">*</span>
        </label>
        <input
          id="fgo-codUnic"
          type="text"
          value={codUnic}
          onChange={(e) => setCodUnic(e.target.value)}
          placeholder="ex. RO12345678"
          className="w-full rounded-md border px-3 py-2 text-sm"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="fgo-privateKey" className="block text-sm font-medium">
          Private Key FGO <span className="text-destructive">*</span>
        </label>
        <input
          id="fgo-privateKey"
          type="password"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder="Cheia privată din contul FGO"
          className="w-full rounded-md border px-3 py-2 text-sm"
          autoComplete="new-password"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="fgo-environment" className="block text-sm font-medium">
          Mediu
        </label>
        <select
          id="fgo-environment"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as 'prod' | 'uat')}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="prod">Producție (prod)</option>
          <option value="uat">Sandbox / UAT (uat)</option>
        </select>
      </div>

      {/* ── Setări avansate (colapsibil) ────────────────────────── */}
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        <span>{showAdvanced ? '▾' : '▸'}</span>
        <span>Setări avansate</span>
      </button>

      {showAdvanced && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="space-y-1">
            <label htmlFor="fgo-defaultSerie" className="block text-sm font-medium">
              Serie implicită facturi
            </label>
            <p className="text-xs text-muted-foreground">
              Dacă nu e completat, FGO folosește seria default din contul tău.
            </p>
            <input
              id="fgo-defaultSerie"
              type="text"
              value={defaultSerie}
              onChange={(e) => setDefaultSerie(e.target.value)}
              placeholder="ex. BV"
              className="w-full rounded-md border px-3 py-2 text-sm"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="fgo-platformUrl" className="block text-sm font-medium">
              PlatformaUrl
            </label>
            <p className="text-xs text-muted-foreground">
              URL-ul public al platformei (opțional, folosit de FGO pentru anti-fraudă).
            </p>
            <input
              id="fgo-platformUrl"
              type="url"
              value={platformUrl}
              onChange={(e) => setPlatformUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-md border px-3 py-2 text-sm"
              autoComplete="off"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={autoEmit}
              onChange={(e) => setAutoEmit(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Emite automat factură la comandă nouă</span>
              <br />
              <span className="text-muted-foreground">
                Dacă activezi, FGO va emite factura imediat ce o comandă e înregistrată în
                platformă. Implicit oprit.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={verificareDuplicat}
              onChange={(e) => setVerificareDuplicat(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Verificare duplicat la FGO</span>
              <br />
              <span className="text-muted-foreground">
                FGO refuză emiterea dacă există deja o factură identică. Recomandat activ.
              </span>
            </span>
          </label>
        </div>
      )}

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
        {busy ? 'Se salvează…' : 'Salvează secrete'}
      </Button>
    </form>
  );
}
