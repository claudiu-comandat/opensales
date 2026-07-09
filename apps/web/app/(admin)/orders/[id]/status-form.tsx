'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ChangeEvent, FormEvent, ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export type OrderStatus =
  | 'new'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'returned'
  | 'cancelled'
  | 'refunded';

export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  returned: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function getValidTransitions(status: string): OrderStatus[] {
  return STATUS_TRANSITIONS[status as OrderStatus] ?? [];
}

interface StatusFormProps {
  orderId: string;
  currentStatus: string;
}

export function StatusForm({ orderId, currentStatus }: StatusFormProps): ReactElement {
  const router = useRouter();
  const targets = getValidTransitions(currentStatus);
  const [target, setTarget] = useState<string>(targets[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) {
    return (
      <span className="text-sm italic text-muted-foreground" data-testid="status-final">
        Status final
      </span>
    );
  }

  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    setTarget(event.target.value);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (target === '') return;
    setBusy(true);
    setError(null);
    try {
      await getApiClient().patch(`/orders/${orderId}/status`, { status: target });
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la schimbarea statusului';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event): void => {
        void handleSubmit(event);
      }}
      className="flex items-center gap-2"
      data-testid="status-form"
    >
      <select
        aria-label="Status nou"
        value={target}
        onChange={handleChange}
        disabled={busy}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {targets.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? 'Se salvează...' : 'Schimbă status'}
      </Button>
      {error !== null ? (
        <span role="alert" className="text-xs text-destructive" data-testid="status-error">
          {error}
        </span>
      ) : null}
    </form>
  );
}
