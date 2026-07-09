'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export interface SecretFieldSchema {
  name: string;
  label?: string;
  type?: 'string' | 'number' | 'password';
  required?: boolean;
}

export interface SecretsFormProps {
  pluginId: string;
  fields: SecretFieldSchema[];
}

export function SecretsForm({ pluginId, fields }: SecretsFormProps): ReactElement {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">Pluginul nu solicită secrete.</p>;
  }

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
      setMessage({ kind: 'ok', text: 'Secrete salvate.' });
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
        return (
          <div key={f.name} className="space-y-1">
            <label htmlFor={inputId} className="block text-sm font-medium">
              {f.label ?? f.name}
              {f.required && <span className="text-destructive"> *</span>}
            </label>
            <input
              id={inputId}
              type={inputType}
              value={values[f.name] ?? ''}
              onChange={(e) => setField(f.name, e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              autoComplete="off"
            />
          </div>
        );
      })}
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
