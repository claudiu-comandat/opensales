import { SettingsView, type ApiKeyInfo, type WorkspaceData } from './settings-view.js';

import type { ReactElement } from 'react';

import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<ReactElement> {
  let workspace: WorkspaceData | null = null;
  let apiKeys: ApiKeyInfo[] = [];

  try {
    const client = await getServerApiClient();
    [workspace, apiKeys] = await Promise.all([
      client.get<WorkspaceData>('/workspace'),
      client.get<ApiKeyInfo[]>('/api-keys').catch(() => []),
    ]);
  } catch {
    // va afișa valorile default
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="t-h1">Setări</h1>
        <p className="t-small mt-1">Profil business, chei API și webhook-uri.</p>
      </div>
      <SettingsView workspace={workspace} apiKeys={apiKeys} />
    </div>
  );
}
