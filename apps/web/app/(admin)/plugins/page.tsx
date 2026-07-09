import Link from 'next/link';

import { PluginsView } from './plugins-view';

import type { Plugin } from './plugins-table';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

async function fetchPlugins(): Promise<Plugin[]> {
  try {
    const client = await getServerApiClient();
    const res = await client.get<{ data: Plugin[] }>('/plugins');
    return res.data ?? [];
  } catch {
    return [];
  }
}

export default async function PluginsPage(): Promise<ReactElement> {
  const plugins = await fetchPlugins();
  const activeCount = plugins.length;
  return (
    <div className="flex flex-col gap-6">
      {/* Hero card */}
      <div
        className="flex flex-wrap items-center gap-4 rounded-[18px] border bg-surface p-5 shadow-os-sm"
        style={{
          borderColor: 'rgba(59,91,255,0.15)',
          background: 'linear-gradient(135deg, rgba(59,91,255,0.06), transparent), var(--surface)',
        }}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-brand-600 text-white">
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
        </div>
        <div className="flex-1">
          <div className="t-h2">{activeCount} pluginuri active</div>
          <div className="t-small mt-1">
            Marketplace-uri și extensii — toate într-un singur loc.
          </div>
        </div>
        <Button asChild size="sm">
          <Link href="/plugins/install">+ Instalează plugin</Link>
        </Button>
      </div>
      <PluginsView plugins={plugins} />
    </div>
  );
}
