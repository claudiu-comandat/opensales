'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import type { ListingRow, PluginGroup } from './page.js';
import type { ChangeEvent, FormEvent, ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_OPTIONS = [
  '',
  'draft',
  'active',
  'pending_approval',
  'paused',
  'error',
  'rejected',
] as const;

export interface ListingsViewProps {
  groups: PluginGroup[];
  initialPluginId: string;
  initialStatus: string;
}

export function ListingsView({
  groups,
  initialPluginId,
  initialStatus,
}: ListingsViewProps): ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pluginId, setPluginId] = useState(initialPluginId);
  const [status, setStatus] = useState(initialStatus);
  const [externalId, setExternalId] = useState('');

  const pluginOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) ids.add(g.pluginId);
    if (initialPluginId) ids.add(initialPluginId);
    return Array.from(ids).sort();
  }, [groups, initialPluginId]);

  const filteredGroups = useMemo<PluginGroup[]>(() => {
    const externalNeedle = externalId.trim().toLowerCase();
    if (!externalNeedle) return groups;
    return groups
      .map((g) => ({
        pluginId: g.pluginId,
        rows: g.rows.filter((r) => r.externalListingId.toLowerCase().includes(externalNeedle)),
      }))
      .filter((g) => g.rows.length > 0);
  }, [groups, externalId]);

  function applyFilters(): void {
    const params = new URLSearchParams();
    if (pluginId) params.set('pluginId', pluginId);
    if (status) params.set('status', status);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs.length > 0 ? `/listings?${qs}` : '/listings');
    });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    applyFilters();
  }

  function handleReset(): void {
    setPluginId('');
    setStatus('');
    setExternalId('');
    startTransition(() => {
      router.replace('/listings');
    });
  }

  const filterInputCls =
    'h-9 rounded-[10px] border border-ink-200 bg-surface px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15';
  return (
    <div className="flex flex-col gap-6">
      <form
        aria-label="Listings filters"
        className="flex flex-wrap items-end gap-3 rounded-[18px] border border-ink-200 bg-surface px-4 py-3 shadow-os-sm"
        onSubmit={handleSubmit}
      >
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-[12px] text-ink-500">Plugin</span>
          <select
            aria-label="Plugin"
            className={filterInputCls}
            value={pluginId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setPluginId(e.target.value)}
          >
            <option value="">All plugins</option>
            {pluginOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-[12px] text-ink-500">Status</span>
          <select
            aria-label="Status"
            className={filterInputCls}
            value={status}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt === '' ? 'All statuses' : opt}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-[12px] text-ink-500">External ID</span>
          <input
            aria-label="External ID"
            className={filterInputCls}
            placeholder="search"
            value={externalId}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setExternalId(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? 'Applying...' : 'Apply'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={isPending}
          >
            Reset
          </Button>
        </div>
      </form>

      {filteredGroups.length === 0 ? (
        <p className="text-[13px] text-ink-500" data-testid="empty-state">
          No listings match the current filters.
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="plugin-groups">
          {filteredGroups.map((group) => (
            <PluginGroupCard key={group.pluginId} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

function PluginGroupCard({ group }: { group: PluginGroup }): ReactElement {
  return (
    <Card data-testid="plugin-group" data-plugin-id={group.pluginId}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Plugin: {group.pluginId}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {group.rows.length} listing{group.rows.length === 1 ? '' : 's'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" role="list">
          {group.rows.map((row) => (
            <ListingRowItem key={row.id} row={row} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'border-green-200 bg-green-50 text-green-700';
    case 'rejected':
    case 'error':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'pending_approval':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'paused':
      return 'border-gray-200 bg-gray-100 text-gray-600';
    case 'draft':
      return 'border-blue-200 bg-blue-50 text-blue-600';
    default:
      return 'border-ink-200 bg-ink-50 text-ink-700';
  }
}

function validationBadgeClass(value: number): string {
  if ([9, 11, 12, 3].includes(value)) return 'border-green-200 bg-green-50 text-green-700';
  if ([5, 6, 8].includes(value)) return 'border-red-200 bg-red-50 text-red-700';
  if ([1, 2, 4].includes(value)) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (value === 10) return 'border-gray-200 bg-gray-100 text-gray-600';
  return 'border-ink-200 bg-ink-50 text-ink-700';
}

function ListingRowItem({ row }: { row: ListingRow }): ReactElement {
  const vs = row.syncState?.validation_status;
  const ovs = row.syncState?.offer_validation_status;
  const rejectReasons = row.syncState?.reject_reasons;

  return (
    <li className="flex flex-col gap-1 py-2 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-mono text-[12px] text-ink-700">{row.externalListingId}</span>
          <span className="font-mono text-[11px] text-ink-500">
            product: {row.productId.slice(0, 8)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(row.status)}`}
            data-testid="status-badge"
          >
            {row.status}
          </span>
          {vs && (
            <span
              className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-[11px] font-medium ${validationBadgeClass(vs.value)}`}
              title={`eMAG validation_status: ${vs.value}`}
              data-testid="emag-validation-badge"
            >
              {vs.description ?? `eMAG ${vs.value}`}
            </span>
          )}
          {ovs?.value === 2 && (
            <span
              className="inline-flex items-center rounded-[6px] border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700"
              title="Pretul ofertei este invalid pe eMAG"
              data-testid="emag-price-badge"
            >
              Pret invalid
            </span>
          )}
          <span className="text-[11px] text-ink-500">
            {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString('ro-RO') : 'never synced'}
          </span>
        </div>
      </div>
      {rejectReasons && rejectReasons.length > 0 && (
        <ul className="ml-1 mt-0.5 list-disc pl-4 text-[11px] text-red-600">
          {rejectReasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
