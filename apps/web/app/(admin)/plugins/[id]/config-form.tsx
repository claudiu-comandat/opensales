'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export interface ConfigFieldSchema {
  name: string;
  label?: string;
  type?: 'string' | 'number' | 'password';
  required?: boolean;
}

export interface ConfigFormProps {
  pluginId: string;
  fields: ConfigFieldSchema[];
  initialValues?: Record<string, unknown>;
}

function toInputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function ConfigForm({
  pluginId,
  fields,
  initialValues = {},
}: ConfigFormProps): ReactElement {
  const initialState: Record<string, string> = {};
  for (const f of fields) {
    initialState[f.name] = toInputValue(initialValues[f.name]);
  }

  const [values, setValues] = useState<Record<string, string>>(initialState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const router = useRouter();

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Pluginul nu expune câmpuri de configurare.</p>
    );
  }

  function setField(name: string, value: string): void {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function validate(): string | null {
    for (const f of fields) {
      if (f.required && values[f.name]?.trim().length === 0) {
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
      if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isNaN(n)) out[f.name] = n;
      } else {
        out[f.name] = raw;
      }
    }
    return out;
  }

  async function handleSubmit(): Promise<void> {
    const validationError = validate();
    if (validationError) {
      setMessage({ kind: 'error', text: validationError });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await getApiClient().post(`/plugins/${pluginId}/configure`, {
        config: buildPayload(),
      });
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
      className="space-y-4"
      data-testid="config-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      {fields.map((f) => {
        const inputId = `config-${f.name}`;
        const inputType = f.type === 'number' ? 'number' : 'text';
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
              required={f.required ?? false}
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
        {busy ? 'Se salvează…' : 'Salvează configurație'}
      </Button>
    </form>
  );
}
