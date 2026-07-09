'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { SecretFieldSchema } from './secrets-form';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

interface WebhookInfo {
  callbackUrl: string | null;
  token: string;
  awbCallbackUrl: string | null;
  awbCallbackConfigured: boolean;
}

const EMAG_PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: 'emag-ro', label: 'eMAG Romania' },
  { value: 'emag-bg', label: 'eMAG Bulgaria' },
  { value: 'emag-hu', label: 'eMAG Hungary' },
  { value: 'fd-ro', label: 'FashionDays Romania' },
  { value: 'fd-bg', label: 'FashionDays Bulgaria' },
];

export interface EmagSecretsFormProps {
  pluginId: string;
  fields: SecretFieldSchema[];
}

export function EmagSecretsForm({ pluginId, fields }: EmagSecretsFormProps): ReactElement {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [registerCallback, setRegisterCallback] = useState(false);
  const [awbCallbackConfigured, setAwbCallbackConfigured] = useState(false);
  const [copiedOrders, setCopiedOrders] = useState(false);
  const [copiedAwb, setCopiedAwb] = useState(false);
  // keep backward compat alias
  const copied = copiedOrders;

  useEffect(() => {
    getApiClient()
      .get<WebhookInfo>(`/plugins/${pluginId}/webhook-info`)
      .then((info) => {
        setWebhookInfo(info);
        setAwbCallbackConfigured(info.awbCallbackConfigured);
      })
      .catch(() => null);
  }, [pluginId]);

  function setField(name: string, value: string): void {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function validate(): string | null {
    for (const f of fields) {
      if (f.required && (values[f.name] ?? '').trim().length === 0) {
        return `Câmpul "${f.label ?? f.name}" este obligatoriu.`;
      }
    }
    return null;
  }

  function buildPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.name] ?? '';
      if (raw.length === 0) continue;
      out[f.name] = raw;
    }
    return out;
  }

  async function copyUrl(): Promise<void> {
    if (!webhookInfo?.callbackUrl) return;
    await navigator.clipboard.writeText(webhookInfo.callbackUrl);
    setCopiedOrders(true);
    setTimeout(() => setCopiedOrders(false), 2000);
  }

  async function copyAwbUrl(): Promise<void> {
    if (!webhookInfo?.awbCallbackUrl) return;
    await navigator.clipboard.writeText(webhookInfo.awbCallbackUrl);
    setCopiedAwb(true);
    setTimeout(() => setCopiedAwb(false), 2000);
  }

  async function handleSubmit(): Promise<void> {
    const err = validate();
    if (err) {
      setMessage({ kind: 'error', text: err });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await getApiClient().post(`/plugins/${pluginId}/configure`, {
        secrets: buildPayload(),
      });

      if (registerCallback && webhookInfo?.callbackUrl) {
        const r = await getApiClient().post<{ ok: boolean; error?: string }>(
          `/plugins/${pluginId}/register-callback`,
          {},
        );
        if (r.ok) {
          setMessage({ kind: 'ok', text: 'Secrete salvate și Callback URL setat pe eMAG.' });
        } else {
          setMessage({
            kind: 'error',
            text: `Secrete salvate, dar callback URL a eșuat: ${r.error ?? 'eroare necunoscută'}`,
          });
        }
      } else {
        setMessage({ kind: 'ok', text: 'Secrete salvate.' });
      }

      // Salvam starea checkbox-ului AWB callback (independent de salvarea secretelor)
      await getApiClient().post(`/plugins/${pluginId}/awb-callback-configured`, {
        configured: awbCallbackConfigured,
      });

      setValues({});
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
      data-testid="secrets-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Secretele sunt stocate criptat în storage-ul pluginului. Lasă câmpul gol pentru a păstra
        valoarea curentă.
      </p>

      {fields.map((f) => {
        const inputId = `secret-${f.name}`;
        const inputType =
          f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text';
        const isPlatform = f.name === 'platform';
        return (
          <div key={f.name} className="space-y-1">
            <label htmlFor={inputId} className="block text-sm font-medium">
              {isPlatform ? 'Platformă' : (f.label ?? f.name)}
              {f.required && <span className="text-destructive"> *</span>}
            </label>
            {isPlatform ? (
              <select
                id={inputId}
                value={values[f.name] ?? ''}
                onChange={(e) => setField(f.name, e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              >
                <option value="">— Selectează platforma —</option>
                {EMAG_PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value})
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={inputId}
                type={inputType}
                value={values[f.name] ?? ''}
                onChange={(e) => setField(f.name, e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                autoComplete="off"
              />
            )}
          </div>
        );
      })}

      {webhookInfo !== null && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Callback URL comenzi (generat automat):</p>

          {webhookInfo.callbackUrl ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs font-mono">
                {webhookInfo.callbackUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void copyUrl();
                }}
              >
                {copied ? 'Copiat!' : 'Copiază'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-amber-700">
              URL-ul de callback nu poate fi generat — variabila de mediu{' '}
              <strong>RAILWAY_STATIC_URL</strong> sau <strong>PUBLIC_API_URL</strong> nu este
              configurată.
            </p>
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={registerCallback}
              disabled={!webhookInfo.callbackUrl}
              onChange={(e) => setRegisterCallback(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Actualizează Callback URL pe eMAG</span>
              <br />
              <span className="text-muted-foreground">
                La salvare, setează automat URL-ul de mai sus în contul eMAG. Dacă nu bifezi,
                comenzile sunt oricum sincronizate la fiecare oră prin polling.
              </span>
            </span>
          </label>
        </div>
      )}

      {webhookInfo !== null && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">
            Callback URL status AWB (configurare manuala in eMAG):
          </p>

          {webhookInfo.awbCallbackUrl ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs font-mono">
                {webhookInfo.awbCallbackUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void copyAwbUrl();
                }}
              >
                {copiedAwb ? 'Copiat!' : 'Copiaza'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-amber-700">
              URL-ul de callback AWB nu poate fi generat — variabila de mediu{' '}
              <strong>RAILWAY_STATIC_URL</strong> sau <strong>PUBLIC_API_URL</strong> nu este
              configurata.
            </p>
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={awbCallbackConfigured}
              disabled={!webhookInfo.awbCallbackUrl}
              onChange={(e) => setAwbCallbackConfigured(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Am configurat URL-ul AWB in Marketplace eMAG</span>
              <br />
              <span className="text-muted-foreground">
                Bifeaza dupa ce ai adaugat URL-ul de mai sus in sectiunea Callback URL din
                Marketplace eMAG (tip: AWB status change). Daca nu bifezi, statusurile AWB se
                actualizeaza automat la fiecare 4 ore prin polling.
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
