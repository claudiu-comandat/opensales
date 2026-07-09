'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

type WizardStep = 'source' | 'permissions' | 'configure' | 'verify';

type SourceKind = 'tarball' | 'github' | 'npm';

interface ConfigField {
  name: string;
  label?: string;
  type?: 'string' | 'number' | 'password';
  required?: boolean;
}

interface ManifestPreview {
  permissions?: string[];
  secretSchema?: { fields?: ConfigField[] };
  configSchema?: { fields?: ConfigField[] };
}

interface InstallResponse {
  id: string;
  manifest?: ManifestPreview;
}

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'products:read': 'Citește catalogul de produse',
  'products:write': 'Modifică catalogul (create, edit, delete)',
  'orders:read': 'Citește comenzile',
  'orders:write': 'Creează și modifică comenzi',
  'awb:emit': 'Emite AWB pentru comenzi',
  'invoice:emit': 'Emite facturi',
  'customers:read': 'Citește datele clienților',
  'customers:write': 'Modifică datele clienților',
};

function permissionDescription(perm: string): string {
  return PERMISSION_DESCRIPTIONS[perm] ?? perm;
}

const STEPS: readonly { key: WizardStep; label: string }[] = [
  { key: 'source', label: '1. Sursă' },
  { key: 'permissions', label: '2. Permisiuni' },
  { key: 'configure', label: '3. Configurare' },
  { key: 'verify', label: '4. Verificare' },
];

export function InstallWizard(): ReactElement {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>('source');
  const [sourceKind, setSourceKind] = useState<SourceKind>('npm');
  const [source, setSource] = useState('');
  const [pluginId, setPluginId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ManifestPreview | null>(null);
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const permissions = manifest?.permissions ?? [];
  const secretFields = useMemo(() => manifest?.secretSchema?.fields ?? [], [manifest]);
  const configFields = useMemo(() => manifest?.configSchema?.fields ?? [], [manifest]);
  const hasConfigStep = secretFields.length > 0 || configFields.length > 0;

  async function submitSource(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await getApiClient().post<InstallResponse>('/plugins/install-from-source', {
        source,
      });
      setPluginId(res.id);
      setManifest(res.manifest ?? null);
      const initial: Record<string, boolean> = {};
      for (const perm of res.manifest?.permissions ?? []) {
        initial[perm] = false;
      }
      setGranted(initial);
      setStep('permissions');
    } catch {
      setError('Instalarea a eșuat. Verifică sursa furnizată.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPermissions(): Promise<void> {
    if (!pluginId) return;
    setError(null);
    setBusy(true);
    try {
      const list = Object.entries(granted)
        .filter(([, v]) => v)
        .map(([k]) => k);
      await getApiClient().post(`/plugins/${pluginId}/permissions`, { permissions: list });
      setStep(hasConfigStep ? 'configure' : 'verify');
    } catch {
      setError('Nu s-au putut salva permisiunile.');
    } finally {
      setBusy(false);
    }
  }

  async function submitConfigure(): Promise<void> {
    if (!pluginId) return;
    setError(null);
    setBusy(true);
    try {
      await getApiClient().post(`/plugins/${pluginId}/configure`, {
        secrets: secretFields.length > 0 ? secrets : undefined,
        config: configFields.length > 0 ? config : undefined,
      });
      setStep('verify');
    } catch {
      setError('Configurarea a eșuat.');
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify(): Promise<void> {
    if (!pluginId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await getApiClient().post<{ ok: boolean; reason?: string }>(
        `/plugins/${pluginId}/verify`,
      );
      setVerifyResult(res);
      if (res.ok) {
        setTimeout(() => {
          router.push('/plugins');
          router.refresh();
        }, 800);
      }
    } catch {
      setError('Verificarea a eșuat.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="install-wizard">
      <ol className="flex flex-wrap gap-3 text-sm" aria-label="Pașii instalării">
        {STEPS.map((s) => (
          <li
            key={s.key}
            data-testid={`step-indicator-${s.key}`}
            className={s.key === step ? 'font-semibold text-foreground' : 'text-muted-foreground'}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {step === 'source' && (
        <section aria-labelledby="step-source-title" className="space-y-3">
          <h2 id="step-source-title" className="text-lg font-medium">
            Alege sursa
          </h2>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tip sursă</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {(['tarball', 'github', 'npm'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="source-kind"
                    value={k}
                    checked={sourceKind === k}
                    onChange={() => setSourceKind(k)}
                  />
                  <span className="capitalize">{k}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="source-input" className="mb-1 block text-sm font-medium">
              {sourceKind === 'tarball' && 'Cale către tarball (.tgz)'}
              {sourceKind === 'github' && 'URL repo GitHub'}
              {sourceKind === 'npm' && 'Pachet npm (ex. @opensales-plugin/example)'}
            </label>
            <input
              id="source-input"
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder={
                sourceKind === 'github'
                  ? 'https://github.com/owner/repo'
                  : sourceKind === 'npm'
                    ? '@opensales-plugin/example@1.0.0'
                    : '/path/to/plugin.tgz'
              }
            />
          </div>
          <Button
            type="button"
            disabled={busy || source.trim().length === 0}
            onClick={() => {
              void submitSource();
            }}
          >
            {busy ? 'Se instalează…' : 'Continuă'}
          </Button>
        </section>
      )}

      {step === 'permissions' && (
        <section aria-labelledby="step-permissions-title" className="space-y-3">
          <h2 id="step-permissions-title" className="text-lg font-medium">
            Permisiuni cerute
          </h2>
          {permissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Pluginul nu cere permisiuni speciale.</p>
          ) : (
            <ul className="space-y-2">
              {permissions.map((perm) => (
                <li key={perm} className="flex items-start gap-2">
                  <input
                    id={`perm-${perm}`}
                    type="checkbox"
                    checked={granted[perm] ?? false}
                    onChange={(e) => setGranted((prev) => ({ ...prev, [perm]: e.target.checked }))}
                    className="mt-1"
                  />
                  <label htmlFor={`perm-${perm}`} className="text-sm">
                    <span className="font-medium">{perm}</span>
                    <span className="block text-muted-foreground">
                      {permissionDescription(perm)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              void submitPermissions();
            }}
          >
            {busy ? 'Se salvează…' : 'Continuă'}
          </Button>
        </section>
      )}

      {step === 'configure' && (
        <section aria-labelledby="step-configure-title" className="space-y-3">
          <h2 id="step-configure-title" className="text-lg font-medium">
            Configurare
          </h2>
          {secretFields.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Secrete</h3>
              {secretFields.map((f) => (
                <div key={f.name}>
                  <label htmlFor={`secret-${f.name}`} className="mb-1 block text-sm font-medium">
                    {f.label ?? f.name}
                    {f.required && <span className="text-destructive"> *</span>}
                  </label>
                  <input
                    id={`secret-${f.name}`}
                    type={f.type === 'password' ? 'password' : 'text'}
                    value={secrets[f.name] ?? ''}
                    onChange={(e) => setSecrets((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          )}
          {configFields.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Setări</h3>
              {configFields.map((f) => (
                <div key={f.name}>
                  <label htmlFor={`config-${f.name}`} className="mb-1 block text-sm font-medium">
                    {f.label ?? f.name}
                    {f.required && <span className="text-destructive"> *</span>}
                  </label>
                  <input
                    id={`config-${f.name}`}
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={config[f.name] ?? ''}
                    onChange={(e) => setConfig((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          )}
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              void submitConfigure();
            }}
          >
            {busy ? 'Se salvează…' : 'Continuă'}
          </Button>
        </section>
      )}

      {step === 'verify' && (
        <section aria-labelledby="step-verify-title" className="space-y-3">
          <h2 id="step-verify-title" className="text-lg font-medium">
            Verificare
          </h2>
          <p className="text-sm text-muted-foreground">
            Rulează healthCheck-ul pluginului pentru a confirma că este funcțional.
          </p>
          {verifyResult && (
            <p
              role="status"
              data-testid="verify-result"
              className={verifyResult.ok ? 'text-sm text-green-700' : 'text-sm text-destructive'}
            >
              {verifyResult.ok
                ? 'Plugin verificat cu succes. Te redirecționăm…'
                : `Verificare eșuată: ${verifyResult.reason ?? 'motiv necunoscut'}`}
            </p>
          )}
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              void submitVerify();
            }}
          >
            {busy ? 'Se verifică…' : 'Verifică'}
          </Button>
        </section>
      )}
    </div>
  );
}
