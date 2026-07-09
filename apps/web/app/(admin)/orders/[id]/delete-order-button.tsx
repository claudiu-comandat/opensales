'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

export function DeleteOrderButton({ orderId }: { orderId: string }): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    if (
      !confirm(
        'Sigur vrei să ștergi comanda? Acțiunea este ireversibilă și va restaura stocul produselor.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await getApiClient().delete(`/orders/${orderId}`);
      router.push('/orders');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la ștergere';
      setError(message);
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => void handleDelete()} disabled={busy}>
        {busy ? 'Se șterge...' : 'Șterge comanda'}
      </Button>
      {error !== null && <span className="text-xs text-danger">{error}</span>}
    </>
  );
}
