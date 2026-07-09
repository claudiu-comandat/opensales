'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { Plugin } from './plugins-table';
import type { ReactElement } from 'react';

import { MPLogo, packageToLogoName } from '@/components/mp-logo';
import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

type Tab = 'all' | 'marketplace' | 'plugin' | 'available';

const STATUS_LABEL: Record<Plugin['status'], string> = {
  pending_verification: 'În așteptare',
  active: 'Activ',
  error: 'Eroare',
  disabled: 'Dezactivat',
};

const STATUS_CHIP: Record<Plugin['status'], string> = {
  pending_verification: 'bg-warning-bg text-warning',
  active: 'bg-success-bg text-success',
  error: 'bg-danger-bg text-danger',
  disabled: 'bg-ink-100 text-ink-600',
};

const STATUS_DOT: Record<Plugin['status'], string> = {
  pending_verification: 'bg-warning',
  active: 'bg-success',
  error: 'bg-danger',
  disabled: 'bg-ink-400',
};

function classifyPlugin(p: Plugin): 'marketplace' | 'plugin' {
  const t = p.manifest?.type;
  if (typeof t === 'string' && t.toLowerCase().includes('market')) return 'marketplace';
  return 'plugin';
}

interface PluginCardProps {
  plugin: Plugin;
  busy: boolean;
  onAction: (id: string, action: 'verify' | 'disable' | 'enable' | 'uninstall') => void;
}

function PluginCard({ plugin, busy, onAction }: PluginCardProps): ReactElement {
  const kind = classifyPlugin(plugin);
  const isMP = kind === 'marketplace';
  const subtitle = isMP ? 'Marketplace' : (plugin.manifest?.type ?? 'Extensie');
  const title = plugin.displayName ?? plugin.packageName;
  const logoName = packageToLogoName(plugin.packageName);
  const logoDataUri = plugin.manifest?.logoDataUri;

  return (
    <div
      data-testid={`plugin-row-${plugin.id}`}
      className="flex flex-col gap-3 rounded-[18px] border border-ink-200 bg-surface p-4 shadow-os-sm"
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] ${
            isMP || logoDataUri !== undefined
              ? 'bg-ink-50 px-2.5 text-ink-700'
              : 'w-11 bg-brand-50 text-brand-700'
          }`}
        >
          {isMP || logoDataUri !== undefined ? (
            <MPLogo
              name={logoName}
              size={22}
              {...(logoDataUri !== undefined ? { logoDataUri } : {})}
            />
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/plugins/${plugin.id}`}
              data-testid={`plugin-link-${plugin.id}`}
              className="truncate text-[14px] font-medium text-ink-900 underline-offset-2 hover:text-brand-700 hover:underline"
            >
              {title}
            </Link>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            {subtitle} · v{plugin.version}
          </div>
          <div className="mt-1.5">
            <span
              data-testid={`status-${plugin.status}`}
              className={`inline-flex h-[20px] items-center gap-1.5 rounded-full px-2 text-[11px] font-medium leading-none ${STATUS_CHIP[plugin.status]}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[plugin.status]}`} />
              {STATUS_LABEL[plugin.status]}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button asChild variant="outline" size="sm" className="flex-1">
          <Link href={`/plugins/${plugin.id}`}>{isMP ? 'Setări' : 'Configurează'}</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={(): void => onAction(plugin.id, 'verify')}
        >
          Verifică
        </Button>
        {plugin.status === 'disabled' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(): void => onAction(plugin.id, 'enable')}
          >
            Activează
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(): void => onAction(plugin.id, 'disable')}
          >
            Dezactivează
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={(): void => onAction(plugin.id, 'uninstall')}
        >
          Șterge
        </Button>
      </div>
    </div>
  );
}

interface PluginsViewProps {
  plugins: Plugin[];
}

export function PluginsView({ plugins }: PluginsViewProps): ReactElement {
  const [tab, setTab] = useState<Tab>('all');
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

  function handleAction(id: string, action: 'verify' | 'disable' | 'enable' | 'uninstall'): void {
    void callAction(id, action);
  }

  const marketplaces = plugins.filter((p) => classifyPlugin(p) === 'marketplace');
  const extensions = plugins.filter((p) => classifyPlugin(p) === 'plugin');

  const counts = {
    all: plugins.length,
    marketplace: marketplaces.length,
    plugin: extensions.length,
    available: 0,
  } as const;

  const tabs: readonly { k: Tab; l: string; n: number }[] = [
    { k: 'all', l: 'Toate', n: counts.all },
    { k: 'marketplace', l: 'Marketplace-uri', n: counts.marketplace },
    { k: 'plugin', l: 'Extensii', n: counts.plugin },
    { k: 'available', l: 'Disponibile pentru conectare', n: counts.available },
  ];

  if (plugins.length === 0) {
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
    <div className="flex flex-col gap-4">
      {error !== null ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-ink-200">
        {tabs.map((t) => {
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              type="button"
              onClick={(): void => setTab(t.k)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium ${
                active
                  ? 'border-ink-900 text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-700'
              }`}
            >
              {t.l}
              <span
                className={`rounded-md px-1.5 py-px text-[11px] font-medium ${
                  active ? 'bg-ink-900 text-surface' : 'bg-ink-100 text-ink-600'
                }`}
              >
                {t.n}
              </span>
            </button>
          );
        })}
      </div>

      {(tab === 'all' || tab === 'marketplace') && marketplaces.length > 0 ? (
        <div>
          {tab === 'all' ? (
            <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-500">
              Marketplace-uri conectate
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {marketplaces.map((p) => (
              <PluginCard key={p.id} plugin={p} busy={busyId === p.id} onAction={handleAction} />
            ))}
          </div>
        </div>
      ) : null}

      {(tab === 'all' || tab === 'plugin') && extensions.length > 0 ? (
        <div>
          {tab === 'all' ? (
            <div className="mb-2.5 mt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-500">
              Extensii instalate
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {extensions.map((p) => (
              <PluginCard key={p.id} plugin={p} busy={busyId === p.id} onAction={handleAction} />
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'available' ? (
        <div className="rounded-[18px] border border-dashed border-ink-300 bg-surface p-10 text-center text-[13px] text-ink-500">
          Niciun marketplace disponibil pentru conectare în acest moment.
        </div>
      ) : null}
    </div>
  );
}
