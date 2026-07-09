'use client';

import { useEffect, useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

interface WebhookInfo {
  callbackUrl: string | null;
  token: string;
}

interface RegisterResult {
  ok: boolean;
  error?: string;
  callbackUrl: string | null;
}

export function EmagCallbackSection({ pluginId }: { pluginId: string }): ReactElement {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getApiClient()
      .get<WebhookInfo>(`/plugins/${pluginId}/webhook-info`)
      .then(setInfo)
      .catch(() => null);
  }, [pluginId]);

  async function handleRegister(): Promise<void> {
    if (!overwrite) return;
    setRegistering(true);
    setResult(null);
    try {
      const r = await getApiClient().post<RegisterResult>(
        `/plugins/${pluginId}/register-callback`,
        {},
      );
      if (r.ok) {
        setResult({ kind: 'ok', text: 'Callback URL setat pe eMAG cu succes.' });
      } else {
        setResult({
          kind: 'error',
          text: r.error ?? 'Eroare la înregistrarea callback-ului pe eMAG.',
        });
      }
    } catch {
      setResult({ kind: 'error', text: 'Eroare de comunicare cu API-ul.' });
    } finally {
      setRegistering(false);
    }
  }

  async function copyUrl(): Promise<void> {
    if (!info?.callbackUrl) return;
    await navigator.clipboard.writeText(info.callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Platforma generează automat un URL unic de callback pentru această instalare. eMAG va apela
        acest URL la fiecare comandă nouă.
      </p>

      {info === null ? (
        <p className="text-sm text-muted-foreground">Se încarcă...</p>
      ) : info.callbackUrl ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Callback URL (generat automat):</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs font-mono">
              {info.callbackUrl}
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
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            <strong>PUBLIC_API_URL</strong> nu este configurat. Setează variabila de mediu
            PUBLIC_API_URL (URL-ul public al API-ului) pentru a genera callback URL-ul.
          </p>
        </div>
      )}

      {info?.callbackUrl && (
        <div className="space-y-3 rounded-md border p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm">
              <span className="font-medium">Actualizează Callback URL pe eMAG</span>
              <br />
              <span className="text-muted-foreground">
                Setează automat URL-ul de mai sus în contul eMAG (suprascrie orice URL configurat
                anterior). eMAG permite un singur callback URL per cont.
              </span>
            </span>
          </label>

          {!overwrite && (
            <p className="text-xs text-muted-foreground">
              Dacă nu activezi această opțiune, poți configura URL-ul manual în interfața
              Marketplace eMAG. Comenzile vor fi sincronizate oricum prin polling la fiecare oră.
            </p>
          )}

          {overwrite && (
            <Button
              type="button"
              onClick={() => {
                void handleRegister();
              }}
              disabled={registering}
              size="sm"
            >
              {registering ? 'Se înregistrează...' : 'Aplică Callback URL pe eMAG'}
            </Button>
          )}
        </div>
      )}

      {result && (
        <p
          role={result.kind === 'error' ? 'alert' : 'status'}
          className={
            result.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-green-700'
          }
        >
          {result.text}
        </p>
      )}

      <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
        <p className="text-sm text-blue-800">
          <strong>Notă:</strong> Indiferent de setarea callback-ului, comenzile sunt sincronizate
          automat la fiecare oră prin polling. Callback-ul este o metodă suplimentară pentru
          notificări în timp real.
        </p>
      </div>
    </div>
  );
}
