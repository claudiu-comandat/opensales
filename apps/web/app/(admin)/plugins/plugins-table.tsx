'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

export type PluginStatus = 'pending_verification' | 'active' | 'error' | 'disabled';

export interface Plugin {
  id: string;
  packageName: string;
  version: string;
  displayName?: string;
  status: PluginStatus;
  manifest?: { type?: string; logoDataUri?: string };
  grantedPermissions?: string[];
  lastError?: string | null;
}

const STATUS_LABEL: Record<PluginStatus, string> = {
  pending_verification: 'În așteptare',
  active: 'Activ',
  error: 'Eroare',
  disabled: 'Dezactivat',
};

const STATUS_CHIP: Record<PluginStatus, string> = {
  pending_verification: 'bg-warning-bg text-warning',
  active: 'bg-success-bg text-success',
  error: 'bg-danger-bg text-danger',
  disabled: 'bg-ink-100 text-ink-600',
};

const STATUS_DOT: Record<PluginStatus, string> = {
  pending_verification: 'bg-warning',
  active: 'bg-success',
  error: 'bg-danger',
  disabled: 'bg-ink-400',
};

function StatusBadge({ status }: { status: PluginStatus }): ReactElement {
  return (
    <span
      data-testid={`status-${status}`}
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium leading-none ${STATUS_CHIP[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PluginsTable({ rows }: { rows: Plugin[] }): ReactElement {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callAction(
    id: string,
    action: 'verify' | 'disable' | 'enable' | 'uninstall',
  ): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      const client = getApiClient();
      if (action === 'uninstall') {
        await client.delete(`/plugins/${id}`);
      } else {
        await client.post(`/plugins/${id}/${action}`);
      }
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch {
      setError(`Acțiunea "${action}" a eșuat pentru ${id}.`);
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div
        role="status"
        className="rounded-[18px] border border-dashed border-ink-300 bg-surface p-10 text-center text-[13px] text-ink-500"
      >
        Niciun plugin instalat. Apasă „Instalează plugin” pentru a începe.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Plugin
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Pachet
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Versiune
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Status
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-right text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Acțiuni
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`plugin-row-${row.id}`}
                  className="transition-colors hover:[&>td]:bg-ink-50"
                >
                  <td className="border-b border-ink-100 px-[14px] py-3 align-middle font-medium text-ink-900">
                    <Link
                      href={`/plugins/${row.id}`}
                      className="text-ink-900 underline-offset-2 hover:text-brand-700 hover:underline"
                      data-testid={`plugin-link-${row.id}`}
                    >
                      {row.displayName ?? row.packageName}
                    </Link>
                  </td>
                  <td className="border-b border-ink-100 px-[14px] py-3 align-middle font-mono text-[12.5px] text-ink-600">
                    {row.packageName}
                  </td>
                  <td className="border-b border-ink-100 px-[14px] py-3 align-middle font-mono tabular-nums text-[13px] text-ink-600">
                    {row.version}
                  </td>
                  <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => {
                          void callAction(row.id, 'verify');
                        }}
                      >
                        Verifică
                      </Button>
                      {row.status === 'disabled' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.id}
                          onClick={() => {
                            void callAction(row.id, 'enable');
                          }}
                        >
                          Activează
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.id}
                          onClick={() => {
                            void callAction(row.id, 'disable');
                          }}
                        >
                          Dezactivează
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busyId === row.id}
                        onClick={() => {
                          void callAction(row.id, 'uninstall');
                        }}
                      >
                        Șterge
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
