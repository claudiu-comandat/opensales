import { notFound } from 'next/navigation';

import { ConfigForm } from './config-form';
import { EmagConfigForm } from './emag-config-form';
import { EmagSecretsForm } from './emag-secrets-form';
import { EmagSyncButton } from './emag-sync-button';
import { EmagValidationSyncButton } from './emag-validation-sync-button';
import { FgoSecretsForm } from './fgo-secrets-form';
import { MarketplacesForm } from './marketplaces-form';
import { OrderSyncButton } from './order-sync-button';
import { PermissionsForm } from './permissions-form';
import { SecretsForm } from './secrets-form';
import { TrendyolConfigForm } from './trendyol-config-form';
import { TrendyolInvoiceBackfillButton } from './trendyol-invoice-backfill-button';
import { TrendyolInvoiceRefsBackfillButton } from './trendyol-invoice-refs-backfill-button';

import type { ReactElement } from 'react';

import { ApiError } from '@/lib/api-types';
import { supportedMarketplacesForPackage } from '@/lib/marketplace-catalog';
import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

export interface ConfigFieldSchema {
  name: string;
  label?: string;
  type?: 'string' | 'number' | 'password';
  required?: boolean;
}

export interface PluginManifest {
  type?: string;
  description?: string;
  permissions?: string[];
  secretSchema?: { fields?: ConfigFieldSchema[] };
  configSchema?: { fields?: ConfigFieldSchema[] };
}

export interface PluginDetail {
  id: string;
  packageName: string;
  version: string;
  displayName: string;
  status: string;
  manifest: PluginManifest;
  config: Record<string, unknown>;
  grantedPermissions: string[];
  lastError: string | null;
  lastHealthCheckAt: string | null;
  installedAt: string;
}

async function fetchPlugin(id: string): Promise<PluginDetail> {
  const client = await getServerApiClient();
  return client.get<PluginDetail>(`/plugins/${id}`);
}

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;

  let plugin: PluginDetail;
  try {
    plugin = await fetchPlugin(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notFound();
    }
    throw e;
  }

  const declaredPermissions = plugin.manifest.permissions ?? [];
  const secretFields = plugin.manifest.secretSchema?.fields ?? [];
  const configFields = plugin.manifest.configSchema?.fields ?? [];
  const supportedMarketplaces = supportedMarketplacesForPackage(plugin.packageName);
  const enabledMarketplaces = Array.isArray(plugin.config.enabledMarketplaces)
    ? (plugin.config.enabledMarketplaces as string[])
    : [];

  return (
    <div className="max-w-4xl space-y-6" data-testid="plugin-detail">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{plugin.displayName}</h1>
        <p className="font-mono text-sm text-muted-foreground">
          {plugin.packageName}@{plugin.version}
        </p>
        <p className="text-sm">
          <span className="font-medium">Status:</span>{' '}
          <span data-testid="plugin-status">{plugin.status}</span>
        </p>
        {plugin.manifest.description && (
          <p className="text-sm text-muted-foreground">{plugin.manifest.description}</p>
        )}
        {plugin.lastError && (
          <p className="text-sm text-destructive" role="alert">
            Eroare: {plugin.lastError}
          </p>
        )}
        {plugin.lastHealthCheckAt && (
          <p className="text-sm text-muted-foreground">
            Ultim health check: {new Date(plugin.lastHealthCheckAt).toLocaleString('ro-RO')}
          </p>
        )}
      </header>

      <section aria-labelledby="permissions-heading" className="space-y-3 rounded-md border p-4">
        <h2 id="permissions-heading" className="text-lg font-medium">
          Permisiuni
        </h2>
        <PermissionsForm
          pluginId={plugin.id}
          declaredPermissions={declaredPermissions}
          grantedPermissions={plugin.grantedPermissions}
        />
      </section>

      {plugin.packageName === '@opensales-plugin/trendyol' ? (
        <section aria-labelledby="config-heading" className="space-y-3 rounded-md border p-4">
          <h2 id="config-heading" className="text-lg font-medium">
            Configurație
          </h2>
          <TrendyolConfigForm
            pluginId={plugin.id}
            secretFields={secretFields}
            supported={supportedMarketplaces}
            initialConfig={plugin.config}
          />
        </section>
      ) : plugin.packageName === '@opensales-plugin/emag' ? (
        <>
          <section aria-labelledby="config-heading" className="space-y-3 rounded-md border p-4">
            <h2 id="config-heading" className="text-lg font-medium">
              Configurație
            </h2>
            <EmagConfigForm
              pluginId={plugin.id}
              supported={supportedMarketplaces}
              initialConfig={plugin.config}
            />
          </section>

          <section aria-labelledby="secrets-heading" className="space-y-3 rounded-md border p-4">
            <h2 id="secrets-heading" className="text-lg font-medium">
              Secrete
            </h2>
            <EmagSecretsForm pluginId={plugin.id} fields={secretFields} />
          </section>
        </>
      ) : (
        <>
          <section aria-labelledby="config-heading" className="space-y-3 rounded-md border p-4">
            <h2 id="config-heading" className="text-lg font-medium">
              Configurație
            </h2>
            <ConfigForm pluginId={plugin.id} fields={configFields} initialValues={plugin.config} />
          </section>

          {supportedMarketplaces.length > 0 && (
            <section
              aria-labelledby="marketplaces-heading"
              className="space-y-3 rounded-md border p-4"
            >
              <h2 id="marketplaces-heading" className="text-lg font-medium">
                Marketplace-uri active
              </h2>
              <MarketplacesForm
                pluginId={plugin.id}
                supported={supportedMarketplaces}
                initialEnabled={enabledMarketplaces}
              />
            </section>
          )}

          <section aria-labelledby="secrets-heading" className="space-y-3 rounded-md border p-4">
            <h2 id="secrets-heading" className="text-lg font-medium">
              Secrete
            </h2>
            {plugin.packageName === '@opensales-plugin/fgo' ? (
              <FgoSecretsForm pluginId={plugin.id} />
            ) : (
              <SecretsForm pluginId={plugin.id} fields={secretFields} />
            )}
          </section>
        </>
      )}

      {plugin.packageName === '@opensales-plugin/emag' && (
        <section aria-labelledby="sync-heading" className="space-y-3 rounded-md border p-4">
          <h2 id="sync-heading" className="text-lg font-medium">
            Sincronizare comenzi
          </h2>
          <EmagSyncButton />
        </section>
      )}

      {plugin.packageName === '@opensales-plugin/emag' && (
        <section
          aria-labelledby="validation-sync-heading"
          className="space-y-3 rounded-md border p-4"
        >
          <h2 id="validation-sync-heading" className="text-lg font-medium">
            Sincronizare statusuri oferte
          </h2>
          <EmagValidationSyncButton />
        </section>
      )}

      {plugin.packageName === '@opensales-plugin/trendyol' && (
        <section aria-labelledby="sync-heading" className="space-y-3 rounded-md border p-4">
          <h2 id="sync-heading" className="text-lg font-medium">
            Sincronizare comenzi
          </h2>
          <OrderSyncButton syncPath="/orders/sync/trendyol" label="Trendyol" />
        </section>
      )}

      {plugin.packageName === '@opensales-plugin/trendyol' && (
        <section
          aria-labelledby="invoice-backfill-heading"
          className="space-y-3 rounded-md border p-4"
        >
          <h2 id="invoice-backfill-heading" className="text-lg font-medium">
            Backfill facturi Trendyol
          </h2>
          <TrendyolInvoiceBackfillButton />
          <TrendyolInvoiceRefsBackfillButton />
        </section>
      )}

      {plugin.packageName === '@opensales-plugin/temu' && (
        <section aria-labelledby="sync-heading" className="space-y-3 rounded-md border p-4">
          <h2 id="sync-heading" className="text-lg font-medium">
            Sincronizare comenzi
          </h2>
          <OrderSyncButton syncPath="/orders/sync/temu" label="Temu" />
        </section>
      )}
    </div>
  );
}
