'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'products:read': 'Citește catalogul de produse',
  'products:write': 'Modifică catalogul (create, edit, delete)',
  'listings:read': 'Citește listările',
  'listings:write': 'Creează și modifică listări',
  'orders:read': 'Citește comenzile',
  'orders:write': 'Creează comenzi noi',
  'orders:status:write': 'Schimbă status comenzi',
  'stock:read': 'Citește stocul',
  'stock:write': 'Modifică stocul',
  'awb:emit': 'Emite AWB-uri',
  'awb:read': 'Citește AWB-uri',
  'invoice:emit': 'Emite facturi',
  'invoice:read': 'Citește facturi',
  'events:subscribe': 'Se abonează la evenimente platformă',
  'events:emit': 'Emite evenimente custom',
  'http:outbound': 'Apeluri HTTP în afara platformei',
};

export interface PermissionsFormProps {
  pluginId: string;
  declaredPermissions: string[];
  grantedPermissions: string[];
}

export function PermissionsForm({
  pluginId,
  declaredPermissions,
  grantedPermissions,
}: PermissionsFormProps): ReactElement {
  const router = useRouter();
  const [granted, setGranted] = useState<Set<string>>(new Set(grantedPermissions));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function toggle(perm: string): void {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await getApiClient().post(`/plugins/${pluginId}/permissions`, {
        permissions: Array.from(granted),
      });
      setMessage({ kind: 'ok', text: 'Permisiuni salvate.' });
      router.refresh();
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Eroare la salvare.';
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  if (declaredPermissions.length === 0) {
    return <p className="text-sm text-muted-foreground">Pluginul nu cere permisiuni speciale.</p>;
  }

  return (
    <div className="space-y-4" data-testid="permissions-form">
      <p className="text-sm text-muted-foreground">
        Pluginul declară {declaredPermissions.length} permisiuni. Bifează doar pe cele pe care i le
        acorzi.
      </p>
      <ul className="space-y-2">
        {declaredPermissions.map((perm) => {
          const inputId = `perm-${perm}`;
          const description = PERMISSION_DESCRIPTIONS[perm] ?? 'Permisiune custom.';
          return (
            <li key={perm} className="flex items-start gap-3 rounded-md border p-3">
              <input
                id={inputId}
                type="checkbox"
                className="mt-1"
                checked={granted.has(perm)}
                onChange={() => toggle(perm)}
              />
              <label htmlFor={inputId} className="flex-1 cursor-pointer">
                <code className="font-mono text-sm">{perm}</code>
                <span className="block text-sm text-muted-foreground">{description}</span>
              </label>
            </li>
          );
        })}
      </ul>
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
      <Button
        type="button"
        disabled={busy}
        onClick={() => {
          void handleSave();
        }}
      >
        {busy ? 'Se salvează…' : 'Salvează permisiuni'}
      </Button>
    </div>
  );
}
