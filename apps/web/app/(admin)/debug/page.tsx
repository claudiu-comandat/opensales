import { RejectedListingsViewer } from './rejected-listings-viewer.js';
import { RequestsViewer } from './requests-viewer.js';
import { ValidationErrorsViewer } from './validation-errors-viewer.js';

import type { ReactElement, ReactNode } from 'react';

import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

interface DebugInfo {
  system: {
    nodeEnv: string;
    uptimeSeconds: number;
    nodeVersion: string;
    hasPublicApiUrl: boolean;
    railwayStaticUrl: string | null;
  };
  plugins: {
    id: string;
    packageName: string;
    displayName: string;
    version: string;
    status: string;
    lastError: string | null;
    lastHealthCheckAt: string | null;
    installedAt: string;
    grantedPermissions: string[];
  }[];
  orders: {
    total: number;
    byStatus: Record<string, number>;
    last24hCount: number;
  };
  queue: {
    schedules: { name: string; cron: string; updatedOn: string }[];
    jobsByState: { name: string; state: string; count: number }[];
  };
  memory: {
    process: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
      heapLimitMb: number;
      externalMb: number;
      arrayBuffersMb: number;
    };
    importJobs: {
      label: string;
      activeJobs: number;
      bufferedErrors: number;
      debugRecords?: number;
    }[];
    pluginRequestLog: { rows: number; totalMb: number };
  };
}

function StatusBadge({ status }: { status: string }): ReactElement {
  const color =
    status === 'active'
      ? 'bg-green-100 text-green-800'
      : status === 'error'
        ? 'bg-red-100 text-red-800'
        : status === 'disabled'
          ? 'bg-gray-100 text-gray-600'
          : 'bg-yellow-100 text-yellow-800';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>
      {status}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="rounded-lg border bg-surface p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | number | boolean }): ReactElement {
  return (
    <div className="flex items-center justify-between border-b border-ink-100 py-1.5 last:border-0">
      <span className="text-[13px] text-ink-600">{label}</span>
      <span className="font-mono text-[12px] text-ink-900">{String(value)}</span>
    </div>
  );
}

export default async function DebugPage(): Promise<ReactElement> {
  let info: DebugInfo | null = null;
  let error: string | null = null;

  try {
    const client = await getServerApiClient();
    info = await client.get<DebugInfo>('/debug');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Eroare la încărcarea datelor debug.';
  }

  const fetchedAt = new Date().toISOString();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="t-h1">Debug</h1>
        <p className="t-small mt-1 text-ink-500">
          Informații de diagnosticare. Actualizat la: <span className="font-mono">{fetchedAt}</span>
        </p>
      </div>

      {/* Erori „Documentație respinsă” (status rejected) — eMAG & Trendyol */}
      <Section title="Documentație respinsă — erori pe oferte (eMAG / Trendyol)">
        <p className="mb-3 text-[12px] text-ink-500">
          Ofertele cu status <span className="font-mono">rejected</span> grupate pe mesajul de
          eroare primit de la marketplace: câte produse afectează fiecare eroare și care sunt exact
          SKU-urile. Statusurile se actualizează la sincronizarea ofertelor (automat la 2h sau
          manual din pagina plugin-ului).
        </p>
        <RejectedListingsViewer />
      </Section>

      {error !== null ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : info === null ? null : (
        <>
          {/* System */}
          <Section title="Sistem">
            <div>
              <Row label="NODE_ENV" value={info.system.nodeEnv} />
              <Row label="Node.js version" value={info.system.nodeVersion} />
              <Row
                label="Uptime"
                value={`${Math.floor(info.system.uptimeSeconds / 3600)}h ${Math.floor((info.system.uptimeSeconds % 3600) / 60)}m`}
              />
              <Row label="PUBLIC_API_URL configurat" value={info.system.hasPublicApiUrl} />
              <Row label="RAILWAY_STATIC_URL" value={info.system.railwayStaticUrl ?? '(nesetat)'} />
            </div>
          </Section>

          {/* Memory */}
          <Section title="Memorie">
            <p className="mb-3 text-[12px] text-ink-500">
              Heap-ul procesului Node + structurile în memorie despre care știm că pot crește
              nemărginit (Map-urile de progres ale import-urilor, tabela plugin_request_log).
              Reîncarcă pagina pentru o citire nouă.
            </p>
            <div className="mb-4">
              <Row
                label="Heap folosit / limită (--max-old-space-size)"
                value={`${info.memory.process.heapUsedMb} MB / ${info.memory.process.heapLimitMb} MB (${Math.round((info.memory.process.heapUsedMb / info.memory.process.heapLimitMb) * 100)}%)`}
              />
              <Row label="Heap total alocat" value={`${info.memory.process.heapTotalMb} MB`} />
              <Row label="RSS (memorie totală proces)" value={`${info.memory.process.rssMb} MB`} />
              <Row label="External (buffere C++)" value={`${info.memory.process.externalMb} MB`} />
              <Row label="ArrayBuffers" value={`${info.memory.process.arrayBuffersMb} MB`} />
            </div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">
              Joburi de import active în memorie
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                  <th className="pb-2 pr-4 font-medium">Import</th>
                  <th className="pb-2 pr-4 font-medium">Joburi active</th>
                  <th className="pb-2 pr-4 font-medium">Erori bufferate</th>
                  <th className="pb-2 font-medium">Debug records</th>
                </tr>
              </thead>
              <tbody>
                {info.memory.importJobs.map((j) => (
                  <tr key={j.label} className="border-t border-ink-100">
                    <td className="py-1.5 pr-4 text-ink-900">{j.label}</td>
                    <td className="py-1.5 pr-4 font-mono text-ink-900">{j.activeJobs}</td>
                    <td className="py-1.5 pr-4 font-mono text-ink-900">{j.bufferedErrors}</td>
                    <td className="py-1.5 font-mono text-ink-500">{j.debugRecords ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4">
              <Row label="plugin_request_log — rânduri" value={info.memory.pluginRequestLog.rows} />
              <Row
                label="plugin_request_log — dimensiune"
                value={`${info.memory.pluginRequestLog.totalMb} MB`}
              />
            </div>
          </Section>

          {/* Plugins */}
          <Section title={`Plugins (${info.plugins.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                    <th className="pb-2 pr-4 font-medium">Nume</th>
                    <th className="pb-2 pr-4 font-medium">Versiune</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Permisiuni acordate</th>
                    <th className="pb-2 pr-4 font-medium">Ultim health check</th>
                    <th className="pb-2 font-medium">Eroare</th>
                  </tr>
                </thead>
                <tbody>
                  {info.plugins.map((p) => (
                    <tr key={p.id} className="border-t border-ink-100">
                      <td className="py-2 pr-4">
                        <div className="font-medium text-ink-900">{p.displayName}</div>
                        <div className="font-mono text-[11px] text-ink-400">{p.packageName}</div>
                        <div className="font-mono text-[10px] text-ink-300">{p.id}</div>
                      </td>
                      <td className="py-2 pr-4 font-mono text-ink-600">{p.version}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-2 pr-4 text-ink-600">
                        {p.grantedPermissions.length > 0 ? p.grantedPermissions.join(', ') : '—'}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[11px] text-ink-500">
                        {p.lastHealthCheckAt
                          ? new Date(p.lastHealthCheckAt).toLocaleString('ro-RO')
                          : '—'}
                      </td>
                      <td className="py-2 max-w-[300px] truncate font-mono text-[11px] text-red-600">
                        {p.lastError ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Orders */}
          <Section title="Comenzi">
            <div>
              <Row label="Total comenzi" value={info.orders.total} />
              <Row label="Adăugate în ultimele 24h" value={info.orders.last24hCount} />
            </div>
            {Object.keys(info.orders.byStatus).length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">
                  Pe status
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(info.orders.byStatus).map(([status, cnt]) => (
                    <span
                      key={status}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px]"
                    >
                      <span className="text-ink-500">{status}</span>
                      <span className="font-mono font-semibold text-ink-900">{cnt}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </Section>

          {/* Queue schedules */}
          <Section title="pg-boss — Schedule-uri">
            {info.queue.schedules.length === 0 ? (
              <p className="text-[13px] text-ink-400">Niciun schedule înregistrat.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                    <th className="pb-2 pr-4 font-medium">Job</th>
                    <th className="pb-2 pr-4 font-medium">Cron</th>
                    <th className="pb-2 font-medium">Ultima actualizare</th>
                  </tr>
                </thead>
                <tbody>
                  {info.queue.schedules.map((s) => (
                    <tr key={s.name} className="border-t border-ink-100">
                      <td className="py-1.5 pr-4 font-mono text-ink-900">{s.name}</td>
                      <td className="py-1.5 pr-4 font-mono text-ink-600">{s.cron}</td>
                      <td className="py-1.5 font-mono text-[11px] text-ink-500">
                        {new Date(s.updatedOn).toLocaleString('ro-RO')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Zod validation errors (pre-HTTP) */}
          <Section title="Erori de validare payload (Zod — înainte de request HTTP)">
            <p className="mb-3 text-[12px] text-ink-500">
              Push-urile respinse de validarea internă înainte de a ajunge la API-ul
              marketplace-ului. Dacă vezi erori aici, payload-ul nu a fost niciodată trimis.
            </p>
            <ValidationErrorsViewer
              plugins={info.plugins.map((p) => ({ id: p.id, displayName: p.displayName }))}
            />
          </Section>

          {/* Plugin HTTP requests */}
          <Section title="Request-uri către marketplace-uri (eMAG / Temu / Trendyol)">
            <RequestsViewer
              plugins={info.plugins.map((p) => ({
                id: p.id,
                displayName: p.displayName,
                packageName: p.packageName,
              }))}
            />
          </Section>

          {/* Queue jobs by state */}
          <Section title="pg-boss — Joburi (ultimele 7 zile)">
            {info.queue.jobsByState.length === 0 ? (
              <p className="text-[13px] text-ink-400">Niciun job în ultimele 7 zile.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ink-400">
                    <th className="pb-2 pr-4 font-medium">Job</th>
                    <th className="pb-2 pr-4 font-medium">State</th>
                    <th className="pb-2 font-medium">Nr.</th>
                  </tr>
                </thead>
                <tbody>
                  {info.queue.jobsByState.map((j) => (
                    <tr key={`${j.name}-${j.state}`} className="border-t border-ink-100">
                      <td className="py-1.5 pr-4 font-mono text-ink-900">{j.name}</td>
                      <td className="py-1.5 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            j.state === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : j.state === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : j.state === 'active'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {j.state}
                        </span>
                      </td>
                      <td className="py-1.5 font-mono font-semibold text-ink-900">{j.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
