'use client';

import { useState } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

const ROMANIAN_COUNTIES = [
  'Alba',
  'Arad',
  'Argeș',
  'Bacău',
  'Bihor',
  'Bistrița-Năsăud',
  'Botoșani',
  'Brașov',
  'Brăila',
  'Buzău',
  'Caraș-Severin',
  'Călărași',
  'Cluj',
  'Constanța',
  'Covasna',
  'Dâmbovița',
  'Dolj',
  'Galați',
  'Giurgiu',
  'Gorj',
  'Harghita',
  'Hunedoara',
  'Ialomița',
  'Iași',
  'Ilfov',
  'Maramureș',
  'Mehedinți',
  'Mureș',
  'Neamț',
  'Olt',
  'Prahova',
  'Satu Mare',
  'Sălaj',
  'Sibiu',
  'Suceava',
  'Teleorman',
  'Timiș',
  'Tulcea',
  'Vaslui',
  'Vâlcea',
  'Vrancea',
  'București',
];

const EU_COUNTRIES = [
  'România',
  'Austria',
  'Belgia',
  'Bulgaria',
  'Cehia',
  'Cipru',
  'Croația',
  'Danemarca',
  'Estonia',
  'Finlanda',
  'Franța',
  'Germania',
  'Grecia',
  'Irlanda',
  'Italia',
  'Letonia',
  'Lituania',
  'Luxemburg',
  'Malta',
  'Olanda',
  'Polonia',
  'Portugalia',
  'Slovacia',
  'Slovenia',
  'Spania',
  'Suedia',
  'Ungaria',
];

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

type TabKey = 'profile' | 'api';

const inputCls =
  'h-[38px] w-full rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 placeholder:text-ink-400 transition-all focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15';

function FieldLabel({ children }: { children: React.ReactNode }): ReactElement {
  return <div className="mb-1.5 text-[12px] text-ink-500">{children}</div>;
}

export interface WorkspaceData {
  id?: string;
  companyName?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  awbPhone?: string | null;
  email?: string | null;
  street?: string | null;
  vatId?: string | null;
  vatPayer?: boolean | null;
  registrationNumber?: string | null;
  country?: string | null;
  county?: string | null;
  prelistValidatedWebhookUrl?: string | null;
}

export function SettingsView({
  workspace,
  apiKeys: initialApiKeys,
}: {
  workspace: WorkspaceData | null;
  apiKeys: ApiKeyInfo[];
}): ReactElement {
  const [tab, setTab] = useState<TabKey>('profile');

  const [companyName, setCompanyName] = useState(workspace?.companyName ?? '');
  const [contactPerson, setContactPerson] = useState(workspace?.contactPerson ?? '');
  const [email, setEmail] = useState(workspace?.email ?? '');
  const [phone, setPhone] = useState(workspace?.phone ?? '');
  const [awbPhone, setAwbPhone] = useState(workspace?.awbPhone ?? '');
  const [vatId, setVatId] = useState(workspace?.vatId ?? '');
  const [country, setCountry] = useState(workspace?.country ?? 'România');
  const [county, setCounty] = useState(workspace?.county ?? 'Ilfov');
  const [street, setStreet] = useState(workspace?.street ?? '');
  const [vatPayer, setVatPayer] = useState(workspace?.vatPayer ?? false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>(initialApiKeys);
  const [apiKeyAction, setApiKeyAction] = useState<string | null>(null); // keyId being rotated, or 'creating'
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [prelistWebhookUrl, setPrelistWebhookUrl] = useState(
    workspace?.prelistValidatedWebhookUrl ?? '',
  );
  const [prelistSaving, setPrelistSaving] = useState(false);
  const [prelistStatus, setPrelistStatus] = useState<'saved' | 'error' | null>(null);

  const tabs: { k: TabKey; l: string }[] = [
    { k: 'profile', l: 'Profil' },
    { k: 'api', l: 'API & Webhook' },
  ];

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const client = getApiClient();
      await client.patch('/workspace', {
        companyName,
        contactPerson: contactPerson || null,
        email: email || null,
        phone: phone || null,
        awbPhone: awbPhone || null,
        vatId: vatId || null,
        country,
        county: country === 'România' ? county : null,
        street: street || null,
        vatPayer,
      });
      setSaveSuccess(true);
    } catch {
      setSaveError('Salvarea a eșuat. Încearcă din nou.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateKey(): Promise<void> {
    setApiKeyAction('creating');
    setNewRawKey(null);
    try {
      const res = await getApiClient().post<ApiKeyInfo & { rawKey?: string }>('/api-keys');
      setNewRawKey(res.rawKey ?? null);
      setApiKeys((prev) => [res, ...prev]);
    } catch {
      window.alert('Eroare la crearea cheii API.');
    } finally {
      setApiKeyAction(null);
    }
  }

  async function handleRotateKey(keyId: string): Promise<void> {
    if (!window.confirm('Rotirea cheii o va revoca pe cea veche imediat. Continui?')) return;
    setApiKeyAction(keyId);
    setNewRawKey(null);
    setCopied(false);
    try {
      const res = await getApiClient().post<ApiKeyInfo & { rawKey?: string }>(
        `/api-keys/${keyId}/rotate`,
      );
      setNewRawKey(res.rawKey ?? null);
      setApiKeys((prev) => prev.map((k) => (k.id === keyId ? res : k)));
    } catch {
      window.alert('Eroare la rotirea cheii API.');
    } finally {
      setApiKeyAction(null);
    }
  }

  async function handleCopyKey(): Promise<void> {
    if (!newRawKey) return;
    try {
      await navigator.clipboard.writeText(newRawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert('Nu s-a putut copia. Selectează manual cheia.');
    }
  }

  async function handleSavePrelistWebhook(): Promise<void> {
    setPrelistSaving(true);
    setPrelistStatus(null);
    try {
      await getApiClient().patch('/workspace', {
        prelistValidatedWebhookUrl: prelistWebhookUrl.trim() || null,
      });
      setPrelistStatus('saved');
    } catch {
      setPrelistStatus('error');
    } finally {
      setPrelistSaving(false);
    }
  }

  function handleCancel(): void {
    setCompanyName(workspace?.companyName ?? '');
    setContactPerson(workspace?.contactPerson ?? '');
    setEmail(workspace?.email ?? '');
    setPhone(workspace?.phone ?? '');
    setAwbPhone(workspace?.awbPhone ?? '');
    setVatId(workspace?.vatId ?? '');
    setCountry(workspace?.country ?? 'România');
    setCounty(workspace?.county ?? 'Ilfov');
    setStreet(workspace?.street ?? '');
    setSaveError(null);
    setSaveSuccess(false);
  }

  return (
    <div className="grid gap-7 md:grid-cols-[220px_1fr]">
      <aside>
        <div className="t-eyebrow mb-3">Setări</div>
        <div className="flex flex-col gap-1">
          {tabs.map((t) => {
            const active = tab === t.k;
            return (
              <button
                key={t.k}
                type="button"
                onClick={(): void => setTab(t.k)}
                className={`flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
                  active ? 'bg-ink-900 text-white' : 'bg-transparent text-ink-700 hover:bg-ink-100'
                }`}
              >
                {t.l}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex flex-col gap-4">
        {tab === 'profile' && (
          <div className="rounded-[18px] border border-ink-200 bg-surface p-6 shadow-os-sm">
            <div className="t-h2">Profil</div>
            <p className="t-small mb-5 mt-1">
              Aceste informații apar pe facturi, AWB-uri și emailuri către clienți.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Email</FieldLabel>
                <input
                  className={inputCls}
                  type="email"
                  value={email}
                  onChange={(e): void => setEmail(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel>Număr de telefon</FieldLabel>
                <input
                  className={inputCls}
                  type="tel"
                  value={phone}
                  onChange={(e): void => setPhone(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel>Nume Companie</FieldLabel>
                <input
                  className={inputCls}
                  value={companyName}
                  onChange={(e): void => setCompanyName(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel>Persoana de Contact</FieldLabel>
                <input
                  className={inputCls}
                  placeholder="Ex: Ion Popescu"
                  value={contactPerson}
                  onChange={(e): void => setContactPerson(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel>Telefon AWB</FieldLabel>
                <input
                  className={inputCls}
                  type="tel"
                  placeholder="Dacă diferit de numărul principal"
                  value={awbPhone}
                  onChange={(e): void => setAwbPhone(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel>CUI</FieldLabel>
                <input
                  className={`${inputCls} font-mono`}
                  value={vatId}
                  onChange={(e): void => setVatId(e.target.value)}
                />
              </div>

              <div>
                <FieldLabel>Țară</FieldLabel>
                <select
                  className={inputCls}
                  value={country}
                  onChange={(e): void => setCountry(e.target.value)}
                >
                  {EU_COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {country === 'România' && (
                <div>
                  <FieldLabel>Județ</FieldLabel>
                  <select
                    className={inputCls}
                    value={county}
                    onChange={(e): void => setCounty(e.target.value)}
                  >
                    {ROMANIAN_COUNTIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {country !== 'România' && (
                <div>
                  <FieldLabel>VAT Number</FieldLabel>
                  <input
                    className={`${inputCls} font-mono`}
                    placeholder="Ex: DE123456789"
                    value={vatId}
                    onChange={(e): void => setVatId(e.target.value)}
                  />
                </div>
              )}

              <div className={country === 'România' ? 'md:col-span-2' : ''}>
                <FieldLabel>Stradă</FieldLabel>
                <input
                  className={inputCls}
                  value={street}
                  onChange={(e): void => setStreet(e.target.value)}
                />
              </div>

              <div className="md:col-span-2">
                <FieldLabel>TVA</FieldLabel>
                <select
                  className={inputCls}
                  value={vatPayer ? 'payer' : 'nonpayer'}
                  onChange={(e): void => setVatPayer(e.target.value === 'payer')}
                >
                  <option value="nonpayer">Neplătitor de TVA</option>
                  <option value="payer">Plătitor de TVA</option>
                </select>
                <div className="mt-1.5 px-1 text-[11px] text-ink-500">
                  Neplătitor: la trimiterea ofertelor pe eMAG/Trendyol/orice marketplace se forțează
                  mereu TVA 0%, indiferent de TVA-ul setat pe produs.
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              {saveSuccess && (
                <span className="text-[11px] font-medium text-success">Salvat cu succes.</span>
              )}
              {saveError !== null && <span className="text-[11px] text-danger">{saveError}</span>}
              <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                Anulează
              </Button>
              <Button
                type="button"
                onClick={(): void => {
                  void handleSave();
                }}
                disabled={saving}
              >
                {saving ? 'Se salvează...' : 'Salvează'}
              </Button>
            </div>
          </div>
        )}

        {tab === 'api' && (
          <>
            <div className="rounded-[18px] border border-ink-200 bg-surface p-6 shadow-os-sm">
              <div className="t-h2">Chei API</div>
              <p className="t-small mb-4 mt-1">
                Folosește cheia ta pentru a accesa OpenSales API din scripturi sau integrări custom.
              </p>

              {apiKeys.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-ink-200 py-6 text-center">
                  <p className="text-[13px] text-ink-500">Nu există chei API active.</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={(): void => {
                      void handleCreateKey();
                    }}
                    disabled={apiKeyAction === 'creating'}
                  >
                    {apiKeyAction === 'creating' ? 'Se creează...' : '+ Crează cheie'}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {apiKeys.map((k) => (
                    <div key={k.id}>
                      <div className="flex items-center gap-3 rounded-[10px] border border-ink-200 bg-ink-50 p-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-surface text-ink-500">
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-ink-900">{k.name}</div>
                          <div className="font-mono text-[11px] text-ink-500">
                            {k.prefix}••••••••••••••••••••••
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={newRawKey === null}
                          onClick={(): void => {
                            void handleCopyKey();
                          }}
                          title={
                            newRawKey === null
                              ? 'Copierea este disponibilă doar imediat după rotire'
                              : 'Copiază cheia în clipboard'
                          }
                        >
                          {copied ? '✓ Copiat' : 'Copiază'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={apiKeyAction !== null}
                          onClick={(): void => {
                            void handleRotateKey(k.id);
                          }}
                        >
                          {apiKeyAction === k.id ? 'Se rotește...' : 'Rotește'}
                        </Button>
                      </div>
                      <div className="mt-1.5 px-1 text-[11px] text-ink-500">
                        Creată:{' '}
                        {new Date(k.createdAt).toLocaleDateString('ro-RO', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {k.lastUsedAt !== null && (
                          <>
                            {' · '}Ultima utilizare:{' '}
                            {new Date(k.lastUsedAt).toLocaleDateString('ro-RO', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {newRawKey !== null && (
                <div className="mt-4 rounded-[10px] border border-warning bg-warning-bg p-3">
                  <p className="mb-2 text-[12px] font-medium text-warning">
                    ⚠ Aceasta este singura dată când poți vedea cheia. Copiaz-o acum!
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-[6px] bg-surface px-2 py-1.5 font-mono text-[12px] text-ink-900">
                      {newRawKey}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      onClick={(): void => {
                        void handleCopyKey();
                      }}
                    >
                      {copied ? '✓ Copiat' : 'Copiază'}
                    </Button>
                  </div>
                </div>
              )}

              {apiKeys.length > 0 && (
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(): void => {
                      void handleCreateKey();
                    }}
                    disabled={apiKeyAction === 'creating'}
                  >
                    {apiKeyAction === 'creating' ? 'Se creează...' : '+ Cheie nouă'}
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-[18px] border border-ink-200 bg-surface p-6 shadow-os-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="t-h2">Webhook-uri</div>
                  <p className="t-small mt-1">
                    Primești notificări HTTP când se întâmplă evenimente în contul tău.
                  </p>
                </div>
                <Button type="button" size="sm" disabled title="Disponibil curând">
                  + Webhook nou
                </Button>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {[
                  { url: 'https://hooks.aventura.ro/orders/new', events: ['order.created'] },
                  {
                    url: 'https://hooks.aventura.ro/orders/done',
                    events: ['order.finalized', 'order.cancelled'],
                  },
                  { url: 'https://hooks.aventura.ro/inventory', events: ['stock.changed'] },
                ].map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-[10px] border border-ink-200 p-3"
                  >
                    <span className="inline-flex h-[18px] items-center gap-1.5 rounded-full bg-success-bg px-2 text-[10.5px] font-medium leading-none text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      Activ
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[12.5px] font-medium text-ink-900">
                        {w.url}
                      </div>
                      <div className="text-[11px] text-ink-500">
                        Evenimente: {w.events.join(', ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[18px] border border-ink-200 bg-surface p-6 shadow-os-sm">
              <div className="t-h2">Prelistare eMAG</div>
              <p className="t-small mb-4 mt-1">
                URL-ul notificat automat când un produs prelistat e validat de eMAG — primește
                SKU-ul, categoria și caracteristicile atribuite, ca să pornească procesul de
                completare. Lasă gol pentru a dezactiva notificarea.
              </p>
              <div className="flex items-center gap-2">
                <input
                  className={`${inputCls} font-mono`}
                  type="url"
                  placeholder="https://automatizare.example.ro/webhook/prelist-validat"
                  value={prelistWebhookUrl}
                  onChange={(e): void => setPrelistWebhookUrl(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={(): void => {
                    void handleSavePrelistWebhook();
                  }}
                  disabled={prelistSaving}
                >
                  {prelistSaving ? 'Se salvează...' : 'Salvează'}
                </Button>
              </div>
              {prelistStatus === 'saved' && (
                <p className="mt-2 text-[11px] font-medium text-success">Salvat cu succes.</p>
              )}
              {prelistStatus === 'error' && (
                <p className="mt-2 text-[11px] text-danger">
                  Salvarea a eșuat. Verifică URL-ul (trebuie să fie valid) și încearcă din nou.
                </p>
              )}
            </div>

            <div className="rounded-[18px] border border-ink-200 bg-surface p-6 shadow-os-sm">
              <div className="t-h2">Documentație API</div>
              <p className="t-small mb-4 mt-1">Resurse pentru integrare rapidă.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { l: 'Referință API', d: 'OpenAPI 3.1 spec', href: '/rpc/api-docs' },
                  { l: 'Quickstart', d: 'Primul request în 2 min', href: '/rpc/api-docs' },
                  { l: 'Autentificare', d: 'OAuth & API keys', href: '/rpc/api-docs' },
                  {
                    l: 'Documentație generală',
                    d: 'Ghid complet OpenSales',
                    href: '/rpc/api-docs',
                  },
                ].map((d) => (
                  <a
                    key={d.l}
                    href={d.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex flex-col items-start gap-1.5 rounded-[10px] border border-ink-200 bg-surface p-4 text-left transition-colors hover:border-ink-300 hover:bg-ink-50"
                  >
                    <div className="text-[13px] font-medium text-ink-900">{d.l}</div>
                    <div className="text-[11px] text-ink-500">{d.d}</div>
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
