'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { FormEvent, ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

interface AwbValue {
  number: string;
  tracking?: string | undefined;
  tracking_url?: string | undefined;
  carrierPluginId: string;
  pdfUrl?: string | undefined;
  pdf_url?: string | undefined;
  status: string;
  issuedAt: string;
  issued_at?: string | undefined;
}

interface InvoiceValue {
  series: string;
  number: string;
  pdfUrl?: string | undefined;
  status: string;
  issuedAt: string;
}

const AWB_STATUSES = [
  'pending',
  'issued',
  'in_transit',
  'delivered',
  'returned',
  'cancelled',
] as const;

const INVOICE_STATUSES = ['draft', 'issued', 'cancelled'] as const;

interface OrderActionsProps {
  orderId: string;
  marketplace?: string | undefined;
  awbOutgoing: unknown;
  awbReturn: unknown;
  invoice: unknown;
  invoiceStorno: unknown;
  canStorno?: boolean | undefined;
}

export function OrderActions({
  orderId,
  marketplace,
  awbOutgoing,
  awbReturn,
  invoice,
  invoiceStorno,
  canStorno,
}: OrderActionsProps): ReactElement {
  return (
    <div className="space-y-4" data-testid="order-actions">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AwbBlock
          orderId={orderId}
          kind="outgoing"
          value={awbOutgoing as AwbValue | null}
          marketplace={marketplace}
        />
        <AwbBlock orderId={orderId} kind="return" value={awbReturn as AwbValue | null} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InvoiceBlock orderId={orderId} kind="invoice" value={invoice as InvoiceValue | null} />
        <InvoiceBlock
          orderId={orderId}
          kind="storno"
          value={invoiceStorno as InvoiceValue | null}
          hasInvoice={!!invoice}
        />
      </div>
      {(marketplace?.startsWith('emag-') || marketplace?.startsWith('fbe-')) && canStorno ? (
        <EmagActionsBlock orderId={orderId} canStorno={canStorno} />
      ) : null}
    </div>
  );
}

interface AwbBlockProps {
  orderId: string;
  kind: 'outgoing' | 'return';
  value: AwbValue | null;
  marketplace?: string | undefined;
}

function AwbBlock({ orderId, kind, value, marketplace }: AwbBlockProps): ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyEmag, setBusyEmag] = useState(false);
  const [errorEmag, setErrorEmag] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const path = kind === 'outgoing' ? 'awb-outgoing' : 'awb-return';
  const title = kind === 'outgoing' ? 'AWB tur' : 'AWB retur';

  const isEmagOutgoing =
    kind === 'outgoing' && typeof marketplace === 'string' && marketplace.startsWith('emag-');

  async function handleTogglePreview(): Promise<void> {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    setShowPreview(true);
    if (previewData !== null) return; // already fetched
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const data = await getApiClient().post<Record<string, unknown>>(
        `/orders/${orderId}/awb-outgoing/preview-emag`,
        {},
      );
      setPreviewData(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la încărcarea preview-ului';
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleIssueEmag(): Promise<void> {
    setBusyEmag(true);
    setErrorEmag(null);
    try {
      await getApiClient().post(`/orders/${orderId}/awb-outgoing/issue-emag`, {});
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la emiterea AWB';
      setErrorEmag(message);
    } finally {
      setBusyEmag(false);
    }
  }

  async function handleClear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await getApiClient().delete(`/orders/${orderId}/${path}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la ștergere';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(payload: AwbValue): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await getApiClient().put(`/orders/${orderId}/${path}`, {
        number: payload.number,
        tracking: payload.tracking ?? undefined,
        carrierPluginId: payload.carrierPluginId,
        pdfUrl: payload.pdfUrl ?? undefined,
        status: payload.status,
        issuedAt: payload.issuedAt,
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la salvare';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid={`awb-${kind}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex flex-wrap gap-2">
          {isEmagOutgoing && !value ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-blue-500 text-blue-700 hover:bg-blue-50"
              onClick={(): void => {
                void handleTogglePreview();
              }}
              disabled={previewLoading}
              data-testid="awb-emag-preview-toggle"
            >
              {previewLoading
                ? 'Se încarcă…'
                : showPreview
                  ? 'Ascunde preview'
                  : 'Preview parametri'}
            </Button>
          ) : null}
          {isEmagOutgoing && !value ? (
            <Button
              type="button"
              size="sm"
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={(): void => {
                void handleIssueEmag();
              }}
              disabled={busyEmag || busy}
              data-testid="awb-emag-issue"
            >
              {busyEmag ? 'Se emite…' : 'Emite AWB eMAG'}
            </Button>
          ) : null}
          {value && !editing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(): void => {
                void handleClear();
              }}
              disabled={busy}
              data-testid={`awb-${kind}-clear`}
            >
              Șterge
            </Button>
          ) : null}
          {!editing ? (
            <Button
              type="button"
              size="sm"
              onClick={(): void => setEditing(true)}
              disabled={busy}
              data-testid={`awb-${kind}-edit`}
            >
              {value ? 'Modifică' : 'Adaugă'}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {errorEmag !== null ? (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {errorEmag}
          </p>
        ) : null}
        {showPreview ? (
          <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Payload complet trimis la eMAG awb/save
            </p>
            {previewLoading ? (
              <p className="text-[11px] text-blue-600">Se încarcă…</p>
            ) : previewError !== null ? (
              <p className="text-[11px] text-destructive">{previewError}</p>
            ) : previewData !== null ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-blue-900">
                {JSON.stringify(previewData, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
        {error !== null ? (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {editing ? (
          <AwbForm
            initial={value}
            busy={busy}
            onCancel={(): void => {
              setEditing(false);
              setError(null);
            }}
            onSubmit={handleSave}
          />
        ) : value ? (
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Număr: </span>
              <span className="font-mono">{value.number}</span>
            </div>
            {value.tracking ? (
              <div>
                <span className="text-muted-foreground">Tracking: </span>
                <span className="font-mono">{value.tracking}</span>
              </div>
            ) : null}
            <div>
              <span className="text-muted-foreground">Curier: </span>
              <span className="font-mono text-xs">{value.carrierPluginId}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Status: </span>
              <span>{value.status}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Emis: </span>
              <span>
                {Number.isNaN(new Date(value.issuedAt).getTime())
                  ? value.issuedAt
                  : new Date(value.issuedAt).toLocaleString('ro-RO')}
              </span>
            </div>
            {(value.pdfUrl ?? value.pdf_url) ? (
              <div className="flex items-center gap-2">
                <a
                  href={value.pdfUrl ?? value.pdf_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                  data-testid={`awb-${kind}-pdf`}
                >
                  Descarcă PDF
                </a>
                <CopyButton url={value.pdfUrl ?? value.pdf_url ?? ''} label="Copiază link AWB" />
              </div>
            ) : null}
            {value.tracking_url ? (
              <div className="flex items-center gap-2">
                <a
                  href={value.tracking_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Urmărire colet
                </a>
                <CopyButton url={value.tracking_url} label="Copiază link tracking" />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="italic text-muted-foreground">Nu e setat.</p>
        )}
      </CardContent>
    </Card>
  );
}

interface AwbFormProps {
  initial: AwbValue | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: AwbValue) => Promise<void> | void;
}

function AwbForm({ initial, busy, onCancel, onSubmit }: AwbFormProps): ReactElement {
  const [number, setNumber] = useState(initial?.number ?? '');
  const [tracking, setTracking] = useState(initial?.tracking ?? '');
  const [carrierPluginId, setCarrierPluginId] = useState(initial?.carrierPluginId ?? '');
  const [pdfUrl, setPdfUrl] = useState(initial?.pdfUrl ?? '');
  const [status, setStatus] = useState<string>(initial?.status ?? 'pending');
  const [issuedAt, setIssuedAt] = useState<string>(initial?.issuedAt ?? new Date().toISOString());

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSubmit({
      number,
      tracking: tracking || undefined,
      carrierPluginId,
      pdfUrl: pdfUrl || undefined,
      status,
      issuedAt,
    });
  }

  return (
    <form className="space-y-2" onSubmit={handleSubmit}>
      <label className="block text-xs">
        <span className="text-muted-foreground">Număr</span>
        <input
          required
          value={number}
          onChange={(e): void => setNumber(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Tracking</span>
        <input
          value={tracking}
          onChange={(e): void => setTracking(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Carrier plugin ID</span>
        <input
          required
          value={carrierPluginId}
          onChange={(e): void => setCarrierPluginId(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">PDF URL</span>
        <input
          type="url"
          value={pdfUrl}
          onChange={(e): void => setPdfUrl(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Status</span>
        <select
          value={status}
          onChange={(e): void => setStatus(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {AWB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Emis la</span>
        <input
          type="datetime-local"
          value={toLocalInput(issuedAt)}
          onChange={(e): void => setIssuedAt(fromLocalInput(e.target.value))}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Renunță
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Se salvează...' : 'Salvează'}
        </Button>
      </div>
    </form>
  );
}

interface InvoiceBlockProps {
  orderId: string;
  kind: 'invoice' | 'storno';
  value: InvoiceValue | null;
  hasInvoice?: boolean | undefined;
}

function InvoiceBlock({ orderId, kind, value, hasInvoice }: InvoiceBlockProps): ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ title: string; data: unknown } | null>(null);
  const [testLoading, setTestLoading] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const path = kind === 'invoice' ? 'invoice' : 'invoice-storno';
  const title = kind === 'invoice' ? 'Factură' : 'Factură storno';

  async function handleTest(
    action: 'preview-emit' | 'test-emit' | 'preview-storno' | 'test-storno',
    label: string,
  ): Promise<void> {
    setTestLoading(action);
    setTestError(null);
    setTestResult(null);
    try {
      const method = action === 'preview-emit' || action === 'preview-storno' ? 'get' : 'post';
      const data = await getApiClient()[method]<unknown>(`/orders/${orderId}/invoice/${action}`);
      setTestResult({ title: label, data });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la apel test';
      setTestError(message);
    } finally {
      setTestLoading(null);
    }
  }

  async function handleClear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await getApiClient().delete(`/orders/${orderId}/${path}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la ștergere';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(payload: InvoiceValue): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await getApiClient().put(`/orders/${orderId}/${path}`, {
        series: payload.series,
        number: payload.number,
        pdfUrl: payload.pdfUrl ?? undefined,
        status: payload.status,
        issuedAt: payload.issuedAt,
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Eroare la salvare';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid={`invoice-${kind}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex flex-wrap gap-2">
          {kind === 'invoice' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
              disabled={testLoading !== null}
              onClick={(): void => {
                void handleTest('preview-emit', 'Preview payload emit factură → FGO');
              }}
            >
              {testLoading === 'preview-emit' ? 'Se încarcă…' : 'Preview emit'}
            </Button>
          ) : null}
          {kind === 'invoice' && !value ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
              disabled={testLoading !== null}
              onClick={(): void => {
                void handleTest('test-emit', 'Răspuns FGO — test emit (fără stocare)');
              }}
            >
              {testLoading === 'test-emit' ? 'Se execută…' : 'Test emit'}
            </Button>
          ) : null}
          {kind === 'storno' && hasInvoice ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
              disabled={testLoading !== null}
              onClick={(): void => {
                void handleTest('preview-storno', 'Preview payload storno → FGO');
              }}
            >
              {testLoading === 'preview-storno' ? 'Se încarcă…' : 'Preview storno'}
            </Button>
          ) : null}
          {kind === 'storno' && hasInvoice && !value ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
              disabled={testLoading !== null}
              onClick={(): void => {
                void handleTest('test-storno', 'Răspuns FGO — test storno (fără stocare)');
              }}
            >
              {testLoading === 'test-storno' ? 'Se execută…' : 'Test storno'}
            </Button>
          ) : null}
          {value && !editing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(): void => {
                void handleClear();
              }}
              disabled={busy}
              data-testid={`invoice-${kind}-clear`}
            >
              Șterge
            </Button>
          ) : null}
          {!editing ? (
            <Button
              type="button"
              size="sm"
              onClick={(): void => setEditing(true)}
              disabled={busy}
              data-testid={`invoice-${kind}-edit`}
            >
              {value ? 'Modifică' : 'Adaugă'}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {testError !== null ? (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {testError}
          </p>
        ) : null}
        {testResult !== null ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                {testResult.title}
              </p>
              <button
                type="button"
                className="text-[11px] text-amber-500 hover:text-amber-800"
                onClick={(): void => setTestResult(null)}
              >
                ✕
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-amber-900">
              {JSON.stringify(testResult.data, null, 2)}
            </pre>
          </div>
        ) : null}
        {error !== null ? (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {editing ? (
          <InvoiceForm
            initial={value}
            busy={busy}
            onCancel={(): void => {
              setEditing(false);
              setError(null);
            }}
            onSubmit={handleSave}
          />
        ) : value ? (
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Serie / Număr: </span>
              <span className="font-mono">
                {value.series}-{value.number}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Status: </span>
              <span>{value.status}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Emis: </span>
              <span>
                {Number.isNaN(new Date(value.issuedAt).getTime())
                  ? value.issuedAt
                  : new Date(value.issuedAt).toLocaleString('ro-RO')}
              </span>
            </div>
            {value.pdfUrl ? (
              <a
                href={value.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
                data-testid={`invoice-${kind}-pdf`}
              >
                Descarcă PDF
              </a>
            ) : null}
          </div>
        ) : (
          <p className="italic text-muted-foreground">Nu e setată.</p>
        )}
      </CardContent>
    </Card>
  );
}

interface InvoiceFormProps {
  initial: InvoiceValue | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: InvoiceValue) => Promise<void> | void;
}

function InvoiceForm({ initial, busy, onCancel, onSubmit }: InvoiceFormProps): ReactElement {
  const [series, setSeries] = useState(initial?.series ?? '');
  const [number, setNumber] = useState(initial?.number ?? '');
  const [pdfUrl, setPdfUrl] = useState(initial?.pdfUrl ?? '');
  const [status, setStatus] = useState<string>(initial?.status ?? 'draft');
  const [issuedAt, setIssuedAt] = useState<string>(initial?.issuedAt ?? new Date().toISOString());

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSubmit({
      series,
      number,
      pdfUrl: pdfUrl || undefined,
      status,
      issuedAt,
    });
  }

  return (
    <form className="space-y-2" onSubmit={handleSubmit}>
      <label className="block text-xs">
        <span className="text-muted-foreground">Serie</span>
        <input
          required
          value={series}
          onChange={(e): void => setSeries(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Număr</span>
        <input
          required
          value={number}
          onChange={(e): void => setNumber(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">PDF URL</span>
        <input
          type="url"
          value={pdfUrl}
          onChange={(e): void => setPdfUrl(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Status</span>
        <select
          value={status}
          onChange={(e): void => setStatus(e.target.value)}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs">
        <span className="text-muted-foreground">Emisă la</span>
        <input
          type="datetime-local"
          value={toLocalInput(issuedAt)}
          onChange={(e): void => setIssuedAt(fromLocalInput(e.target.value))}
          className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Renunță
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Se salvează...' : 'Salvează'}
        </Button>
      </div>
    </form>
  );
}

function CopyButton({ url, label }: { url: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-[11px] text-ink-500 hover:text-ink-900"
      onClick={(): void => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      title={label}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

interface EmagActionsBlockProps {
  orderId: string;
  canStorno?: boolean | undefined;
}

function EmagActionsBlock({ orderId, canStorno }: EmagActionsBlockProps): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function handleStorno(): Promise<void> {
    setBusy('storno');
    setMessage(null);
    try {
      await getApiClient().post(`/orders/${orderId}/emag-storno`, {});
      setMessage({ kind: 'ok', text: 'Factură storno creată cu succes.' });
      router.refresh();
    } catch (err) {
      const text = err instanceof ApiError ? err.message : 'Eroare la crearea storno.';
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-surface p-4 space-y-3">
      <p className="text-[13px] font-medium text-ink-900">Acțiuni eMAG</p>
      <div className="flex flex-wrap gap-2">
        {canStorno ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={(): void => {
              void handleStorno();
            }}
          >
            {busy === 'storno' ? 'Se procesează…' : 'Creează storno factură'}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={
            message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-green-700'
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}
