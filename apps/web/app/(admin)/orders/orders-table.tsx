'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { ChangeEvent, ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';

export type OrderStatus =
  | 'new'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'undelivered'
  | 'returned'
  | 'cancelled'
  | 'refunded';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'new',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'undelivered',
  'returned',
  'cancelled',
  'refunded',
] as const;

const MARKETPLACE_LABELS: Record<string, string> = {
  'emag-ro': 'eMAG RO',
  'emag-hu': 'eMAG HU',
  'emag-bg': 'eMAG BG',
  'fbe-ro': 'eMAG FBE RO',
  'fbe-hu': 'eMAG FBE HU',
  'fbe-bg': 'eMAG FBE BG',
  'fd-ro': 'Fulfillment RO',
  'fd-bg': 'Fulfillment BG',
  'trendyol-ro': 'Trendyol RO',
  'trendyol-gr': 'Trendyol GR',
  'trendyol-bg': 'Trendyol BG',
  'trendyol-sk': 'Trendyol SK',
  'trendyol-cz': 'Trendyol CZ',
  'trendyol-de': 'Trendyol DE',
  'trendyol-sa': 'Trendyol SA',
  'trendyol-ae': 'Trendyol AE',
  temu: 'Temu',
};

function humanizeMarketplace(code: string | null | undefined): string | null {
  if (!code) return null;
  return MARKETPLACE_LABELS[code] ?? code;
}

export interface OrderRow {
  id: string;
  externalId: string;
  pluginId: string;
  pluginName?: string | undefined;
  /** Codul marketplace sursă (ex. 'emag-ro', 'trendyol-gr'). Null pentru comenzi manuale. */
  marketplace?: string | null;
  status: string;
  total: { amountMinor: string; currency: string };
  customer: { email: string | null; name: string | null };
  placedAt: string;
  awbNumber?: string | null;
  awbTrackingUrl?: string | null;
  awbHasTrendyolLabel?: boolean;
  awbHasEmagLabel?: boolean;
  invoiceSeries?: string | null;
  invoiceStornoSeries?: string | null;
  invoicePdfUrl?: string | null;
  firstItem?: { name: string; sku: string; imageUrl: string | null; quantity: number } | undefined;
  allItems?: { name: string; sku: string; quantity: number }[] | undefined;
  /** 1=Ramburs, 2=Transfer Bancar, 3=Card Online. Null pentru comenzi fără payment_mode_id. */
  paymentModeId?: number | null;
  shippingCost?: { amountMinor: string; currency: string } | null;
  /** 'pickup' = locker/easybox, 'courier' = livrare la domiciliu. Null pentru comenzi non-eMAG. */
  deliveryMode?: string | null;
  /** Data la care clientul a solicitat anularea comenzii eMAG. Null dacă nu s-a cerut anulare. */
  cancellationRequest?: string | null;
  /** true când comanda conține minim un produs neidentificat (productId=null, non-virtual). */
  hasUnmatchedItems?: boolean;
}

interface OrdersTableProps {
  rows: OrderRow[];
  totalPages: number;
  page: number;
  pageSize: number;
  status: string;
  placedAfter: string;
  placedBefore: string;
  search: string;
  marketplaceInclude: string;
  hasInvoice: boolean | undefined;
  hasAwb: boolean;
  hasShipping: boolean;
  hasVoucher: boolean;
  hasUnmatchedItems?: boolean;
  paymentMethod: string;
  deliveryMode: string;
}

function formatTotal(value: OrderRow['total']): string {
  const amount = Number(value.amountMinor) / 100;
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: value.currency,
  }).format(amount);
}

const RO_MONTHS = [
  'Ian',
  'Feb',
  'Mar',
  'Apr',
  'Mai',
  'Iun',
  'Iul',
  'Aug',
  'Sep',
  'Oct',
  'Noi',
  'Dec',
];

// Ancorat la Europe/Bucharest (nu la fusul browserului): placedAt e stocat ca
// instant UTC corect, iar platforma e operată din România — afișăm consistent ora RO.
const BUCHAREST_DATE_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Bucharest',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = BUCHAREST_DATE_PARTS.formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const dd = get('day');
  const yy = get('year');
  const hh = get('hour') === '24' ? '00' : get('hour');
  const mm = get('minute');
  const month = RO_MONTHS[Number(get('month')) - 1] ?? '';
  return `${dd} ${month}. ${yy}, ${hh}:${mm}`;
}

function truncateName(name: string, max = 50): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max).trimEnd()}...`;
}

function openDatePicker(el: HTMLInputElement | null): void {
  if (!el) return;
  type WithShowPicker = HTMLInputElement & { showPicker?: () => void };
  const withPicker = el as WithShowPicker;
  if (typeof withPicker.showPicker === 'function') {
    try {
      withPicker.showPicker();
    } catch {
      // showPicker can throw if not user-initiated; ignore — focus still works.
    }
  }
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'delivered':
      return 'bg-success-bg text-success';
    case 'shipped':
    case 'packed':
      return 'bg-brand-50 text-brand-700';
    case 'processing':
    case 'new':
      return 'bg-warning-bg text-warning';
    case 'undelivered':
    case 'cancelled':
    case 'refunded':
      return 'bg-danger-bg text-danger';
    case 'returned':
      return 'bg-ink-100 text-ink-700';
    default:
      return 'bg-ink-100 text-ink-700';
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'delivered':
      return 'bg-success';
    case 'shipped':
    case 'packed':
      return 'bg-brand-600';
    case 'processing':
    case 'new':
      return 'bg-warning';
    case 'undelivered':
    case 'cancelled':
    case 'refunded':
      return 'bg-danger';
    case 'returned':
      return 'bg-ink-400';
    default:
      return 'bg-ink-400';
  }
}

function humanizePaymentMode(id: number | null | undefined): string {
  switch (id) {
    case 1:
      return 'Ramburs';
    case 2:
      return 'Transfer Bancar';
    case 3:
      return 'Card Online';
    default:
      return '—';
  }
}

export function OrdersTable({
  rows,
  totalPages: totalPagesProp,
  page,
  pageSize: _pageSize,
  status,
  placedAfter,
  placedBefore,
  search,
  marketplaceInclude,
  hasInvoice,
  hasAwb,
  hasShipping,
  hasVoucher,
  hasUnmatchedItems = false,
  paymentMethod,
  deliveryMode,
}: OrdersTableProps): ReactElement {
  const router = useRouter();
  const sp = useSearchParams();
  const totalPages = Math.max(1, totalPagesProp);
  const [filtersOpen, setFiltersOpen] = useState(true);
  // Local state for search input — navigates on Enter to avoid per-keystroke requests.
  const [searchQuery, setSearchQuery] = useState(search);

  interface InvoicePending {
    orderId: string;
    action: 'emit' | 'storno' | 'delete';
  }
  const [pendingInvoice, setPendingInvoice] = useState<InvoicePending | null>(null);

  interface StornoPartialProduct {
    id: number;
    name: string;
    currentQty: number;
    returnQty: number;
  }
  interface StornoPartialState {
    orderId: string;
    loading: boolean;
    submitting: boolean;
    products: StornoPartialProduct[];
  }
  const [stornoPartial, setStornoPartial] = useState<StornoPartialState | null>(null);
  const [pendingAwb, setPendingAwb] = useState<string | null>(null);
  const [downloadingAwbLabel, setDownloadingAwbLabel] = useState<string | null>(null);
  // ID-ul comenzii al cărei dropdown de factură e deschis.
  const [openInvoiceMenu, setOpenInvoiceMenu] = useState<string | null>(null);
  const invoiceMenuRef = useRef<HTMLDivElement | null>(null);
  const [openItemsPopover, setOpenItemsPopover] = useState<string | null>(null);
  const itemsPopoverRef = useRef<HTMLDivElement | null>(null);

  // Închide dropdown-ul când se dă click în afara lui.
  useEffect(() => {
    if (!openInvoiceMenu) return;
    function handleOutside(e: MouseEvent): void {
      if (invoiceMenuRef.current && !invoiceMenuRef.current.contains(e.target as Node)) {
        setOpenInvoiceMenu(null);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openInvoiceMenu]);

  useEffect(() => {
    if (!openItemsPopover) return;
    function handleOutside(e: MouseEvent): void {
      if (itemsPopoverRef.current && !itemsPopoverRef.current.contains(e.target as Node)) {
        setOpenItemsPopover(null);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openItemsPopover]);

  // Sync input when URL-driven search changes (e.g. after reset).
  useEffect(() => {
    setSearchQuery(search);
  }, [search]);

  async function handleEmitInvoice(orderId: string): Promise<void> {
    setPendingInvoice({ orderId, action: 'emit' });
    try {
      await getApiClient().post(`/orders/${orderId}/invoice/emit`);
    } catch {
      window.alert('Eroare la emiterea facturii. Verifică log-urile.');
      return;
    } finally {
      setPendingInvoice(null);
    }
    router.refresh();
  }

  async function handleStornoInvoice(orderId: string): Promise<void> {
    setPendingInvoice({ orderId, action: 'storno' });
    try {
      await getApiClient().post(`/orders/${orderId}/invoice/storno`);
    } catch {
      window.alert('Eroare la stornarea facturii. Verifică log-urile.');
      return;
    } finally {
      setPendingInvoice(null);
    }
    router.refresh();
  }

  interface EmagRawProduct {
    id: number;
    name?: string;
    product_name?: string;
    quantity: number;
    status?: number;
  }
  interface OrderDetailRaw {
    rawPayload?: { products?: EmagRawProduct[] } | null;
  }

  async function openStornoPartial(orderId: string): Promise<void> {
    setStornoPartial({ orderId, loading: true, submitting: false, products: [] });
    try {
      const order = await getApiClient().get<OrderDetailRaw>(`/orders/${orderId}`);
      const raw = order.rawPayload?.products ?? [];
      const products: StornoPartialProduct[] = raw
        .filter((p) => (p.status ?? 1) !== 0 && p.quantity > 0)
        .map((p) => ({
          id: p.id,
          name: p.name ?? p.product_name ?? `Produs #${p.id}`,
          currentQty: p.quantity,
          returnQty: p.quantity,
        }));
      setStornoPartial({ orderId, loading: false, submitting: false, products });
    } catch {
      window.alert('Eroare la încărcarea produselor. Verifică log-urile.');
      setStornoPartial(null);
    }
  }

  async function submitStornoPartial(): Promise<void> {
    if (!stornoPartial || stornoPartial.submitting) return;
    const { orderId, products } = stornoPartial;
    const changed = products.filter((p) => p.returnQty !== p.currentQty || p.returnQty === 0);
    if (changed.length === 0) {
      window.alert('Modifică cantitățile pentru cel puțin un produs returnat.');
      return;
    }
    setStornoPartial((s) => (s ? { ...s, submitting: true } : null));
    try {
      await getApiClient().post(`/orders/${orderId}/emag-storno-partial`, {
        products: products.map((p) => ({ id: p.id, quantity: p.returnQty })),
      });
    } catch {
      window.alert('Eroare la storno parțial eMAG. Verifică log-urile.');
      setStornoPartial((s) => (s ? { ...s, submitting: false } : null));
      return;
    }
    setStornoPartial(null);
    router.refresh();
  }

  async function handleDeleteInvoice(orderId: string): Promise<void> {
    const confirmed = window.confirm(
      'Ești sigur? Factura va fi anulată la FGO și ștearsă din baza de date.',
    );
    if (!confirmed) return;
    setPendingInvoice({ orderId, action: 'delete' });
    try {
      await getApiClient().delete(`/orders/${orderId}/invoice`);
    } catch {
      window.alert('Eroare la ștergerea facturii. Verifică log-urile.');
      return;
    } finally {
      setPendingInvoice(null);
    }
    router.refresh();
  }

  async function handleDownloadAwbLabel(
    orderId: string,
    source: 'trendyol' | 'emag',
  ): Promise<void> {
    setDownloadingAwbLabel(orderId);
    const endpoint =
      source === 'emag' ? `/orders/${orderId}/awb-label-emag` : `/orders/${orderId}/awb-label`;
    try {
      const result = await getApiClient().get<{ pdfBase64: string; contentType?: string }>(
        endpoint,
      );
      const byteChars = atob(result.pdfBase64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: result.contentType ?? 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      window.alert('Eroare la descărcarea PDF-ului AWB. Verifică log-urile.');
    } finally {
      setDownloadingAwbLabel(null);
    }
  }

  async function handleEmitAwb(orderId: string): Promise<void> {
    setPendingAwb(orderId);
    try {
      await getApiClient().post(`/orders/${orderId}/awb-outgoing/issue-emag`, { cod: 0 });
      router.refresh();
    } catch {
      window.alert('Eroare la emiterea AWB. Verifică log-urile.');
    } finally {
      setPendingAwb(null);
    }
  }

  const activeCount = [
    status,
    placedAfter,
    placedBefore,
    search,
    marketplaceInclude,
    paymentMethod,
    deliveryMode,
    hasInvoice ? '1' : '',
    hasAwb ? '1' : '',
    hasShipping ? '1' : '',
    hasVoucher ? '1' : '',
    hasUnmatchedItems ? '1' : '',
  ].filter((v) => v !== '').length;

  function setParam(key: string, value: string): void {
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    params.delete('page');
    const qs = params.toString();
    router.replace(qs.length > 0 ? `/orders?${qs}` : '/orders');
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>): void {
    setParam('status', event.target.value);
  }

  function handlePlacedAfterChange(event: ChangeEvent<HTMLInputElement>): void {
    setParam('placedAfter', event.target.value);
  }

  function handlePlacedBeforeChange(event: ChangeEvent<HTMLInputElement>): void {
    setParam('placedBefore', event.target.value);
  }

  function handleResetFilters(): void {
    setSearchQuery('');
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.delete('status');
    params.delete('placedAfter');
    params.delete('placedBefore');
    params.delete('q');
    params.delete('marketplaceInclude');
    params.delete('paymentMethod');
    params.delete('hasInvoice');
    params.delete('hasAwb');
    params.delete('hasShipping');
    params.delete('hasVoucher');
    params.delete('hasUnmatchedItems');
    params.delete('deliveryMode');
    params.delete('page');
    const qs = params.toString();
    router.replace(qs.length > 0 ? `/orders?${qs}` : '/orders');
  }

  function goToPage(target: number): void {
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.set('page', String(target));
    router.replace(`/orders?${params.toString()}`);
  }

  // All filtering is server-side — rows are already filtered by the API.
  const visibleRows = rows;

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Filter card with integrated CTA */}
        <div className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm">
          <div
            className={`flex items-center gap-2 px-4 py-2.5 ${filtersOpen ? 'border-b border-ink-100' : ''}`}
          >
            <button
              type="button"
              onClick={(): void => setFiltersOpen((o) => !o)}
              className="flex flex-1 items-center gap-2.5 bg-transparent p-0 text-left text-ink-900"
              aria-label="Toggle filtre"
            >
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
                className="text-ink-500"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              <span className="text-[13.5px] font-medium">Filtre</span>
              {activeCount > 0 ? (
                <span className="rounded-[10px] bg-brand-50 px-1.5 py-px text-[11px] font-semibold text-brand-700">
                  {activeCount} active
                </span>
              ) : null}
              <div className="flex-1" />
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mr-1 text-ink-500"
              >
                {filtersOpen ? (
                  <polyline points="18 15 12 9 6 15"></polyline>
                ) : (
                  <polyline points="6 9 12 15 18 9"></polyline>
                )}
              </svg>
            </button>
            <div className="h-5 w-px shrink-0 bg-ink-200" />
            {activeCount > 0 ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="shrink-0 px-1 text-[12px] text-brand-700"
              >
                Resetează
              </button>
            ) : null}
            <Button asChild size="sm" className="shrink-0">
              <Link href="/orders/new">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Comandă manuală
              </Link>
            </Button>
          </div>

          {filtersOpen ? (
            <div className="grid grid-cols-1 gap-3.5 p-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-500">Caută</span>
                <div className="relative">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"
                  >
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input
                    type="search"
                    aria-label="Caută comenzi"
                    placeholder="ID, client, SKU produs... (Enter)"
                    value={searchQuery}
                    onChange={(e): void => {
                      const next = e.target.value;
                      setSearchQuery(next);
                      // Auto-reset filter when input is fully cleared (covers the
                      // native [x] clear button on type="search" + Backspace-to-empty).
                      if (next === '' && search !== '') setParam('q', '');
                    }}
                    onKeyDown={(e): void => {
                      if (e.key === 'Enter') setParam('q', searchQuery);
                    }}
                    className="h-[34px] w-full rounded-[10px] border border-ink-200 bg-surface pl-7 pr-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-500">Status</span>
                <select
                  aria-label="Filtru status"
                  value={status}
                  onChange={handleStatusChange}
                  className="h-[34px] rounded-[10px] border border-ink-200 bg-surface px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
                >
                  <option value="">Toate</option>
                  {ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-500">Marketplace</span>
                <select
                  aria-label="Filtru marketplace"
                  value={marketplaceInclude}
                  onChange={(e): void => setParam('marketplaceInclude', e.target.value)}
                  className="h-[34px] rounded-[10px] border border-ink-200 bg-surface px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
                >
                  <option value="">Toate</option>
                  {Object.entries(MARKETPLACE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-500">Metoda de plată</span>
                <select
                  aria-label="Filtru metodă plată"
                  value={paymentMethod}
                  onChange={(e): void => setParam('paymentMethod', e.target.value)}
                  className="h-[34px] rounded-[10px] border border-ink-200 bg-surface px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
                >
                  <option value="">Toate</option>
                  <option value="1">Ramburs</option>
                  <option value="3">Card Online</option>
                  <option value="2">Transfer Bancar</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-500">Tip livrare</span>
                <select
                  aria-label="Filtru tip livrare"
                  value={deliveryMode}
                  onChange={(e): void => setParam('deliveryMode', e.target.value)}
                  className="h-[34px] rounded-[10px] border border-ink-200 bg-surface px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
                >
                  <option value="">Toate</option>
                  <option value="courier">Curier</option>
                  <option value="pickup">Locker</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-500">De la data</span>
                <input
                  type="date"
                  aria-label="De la data"
                  value={placedAfter}
                  onChange={handlePlacedAfterChange}
                  onClick={(e): void => openDatePicker(e.currentTarget)}
                  onFocus={(e): void => openDatePicker(e.currentTarget)}
                  className="h-[34px] cursor-pointer rounded-[10px] border border-ink-200 bg-surface px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-ink-500">Până la data</span>
                <input
                  type="date"
                  aria-label="Până la data"
                  value={placedBefore}
                  onChange={handlePlacedBeforeChange}
                  onClick={(e): void => openDatePicker(e.currentTarget)}
                  onFocus={(e): void => openDatePicker(e.currentTarget)}
                  className="h-[34px] cursor-pointer rounded-[10px] border border-ink-200 bg-surface px-3 text-[13px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
                />
              </label>
              <div className="flex flex-col justify-center gap-2">
                <span className="text-[12px] text-ink-500">Documente</span>
                <div className="flex flex-col gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
                    <input
                      type="checkbox"
                      checked={hasInvoice === true}
                      onChange={(e): void => setParam('hasInvoice', e.target.checked ? 'true' : '')}
                    />
                    Are factură
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
                    <input
                      type="checkbox"
                      checked={hasInvoice === false}
                      onChange={(e): void =>
                        setParam('hasInvoice', e.target.checked ? 'false' : '')
                      }
                    />
                    Fără factură
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
                    <input
                      type="checkbox"
                      checked={hasAwb}
                      onChange={(e): void => setParam('hasAwb', e.target.checked ? 'true' : '')}
                    />
                    Are AWB
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
                    <input
                      type="checkbox"
                      checked={hasShipping}
                      onChange={(e): void =>
                        setParam('hasShipping', e.target.checked ? 'true' : '')
                      }
                    />
                    Are taxă livrare
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
                    <input
                      type="checkbox"
                      checked={hasVoucher}
                      onChange={(e): void => setParam('hasVoucher', e.target.checked ? 'true' : '')}
                    />
                    Are voucher
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-warning font-medium">
                    <input
                      type="checkbox"
                      checked={hasUnmatchedItems}
                      onChange={(e): void =>
                        setParam('hasUnmatchedItems', e.target.checked ? 'true' : '')
                      }
                    />
                    Produse neidentificate
                  </label>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-[13.5px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    ID Comandă
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Produs
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Client
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Marketplace
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Livrare
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Data
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Factură
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    AWB
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Status
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Plată
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-right text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    Total
                  </th>
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-right text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-[14px] py-10 text-center text-[13px] text-ink-500"
                      data-testid="orders-empty"
                    >
                      Nicio comandă găsită.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
                    <tr
                      key={row.id}
                      data-testid={`order-row-${row.id}`}
                      className={row.hasUnmatchedItems ? '[&>td]:bg-warning-bg/20' : ''}
                    >
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-[13px] font-medium text-ink-900">
                            {row.externalId}
                          </span>
                          {row.hasUnmatchedItems ? (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                              <svg
                                width="7"
                                height="7"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                              </svg>
                              neidentificat
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink-100 text-[10px] text-ink-500">
                            {row.firstItem?.imageUrl ? (
                              <img
                                src={row.firstItem.imageUrl}
                                alt={row.firstItem.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              'IMG'
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-ink-900">
                              {row.firstItem?.name ? truncateName(row.firstItem.name) : '—'}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-ink-500">
                                {row.firstItem?.sku ?? ''}
                              </span>
                              {(row.allItems?.length ?? 0) > 1 ? (
                                <div
                                  className="relative"
                                  ref={openItemsPopover === row.id ? itemsPopoverRef : null}
                                >
                                  <button
                                    type="button"
                                    onClick={(): void => {
                                      setOpenItemsPopover((prev) =>
                                        prev === row.id ? null : row.id,
                                      );
                                    }}
                                    className="flex items-center gap-1 rounded-[6px] bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-600 hover:bg-ink-200"
                                  >
                                    {row.allItems?.length ?? 0} produse ·{' '}
                                    {(row.allItems ?? []).reduce((s, i) => s + i.quantity, 0)} buc.
                                    <svg
                                      width="10"
                                      height="10"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                      className={
                                        openItemsPopover === row.id
                                          ? 'rotate-180 transition-transform'
                                          : 'transition-transform'
                                      }
                                    >
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                  {openItemsPopover === row.id ? (
                                    <div className="absolute left-0 top-full z-20 mt-1 min-w-[260px] rounded-md border border-ink-200 bg-white py-1 shadow-lg">
                                      {(row.allItems ?? []).map((item, idx) => (
                                        <div
                                          key={idx}
                                          className="flex items-start justify-between gap-3 px-3 py-1.5"
                                        >
                                          <div className="min-w-0">
                                            <div className="text-[12px] font-medium text-ink-900">
                                              {truncateName(item.name, 35)}
                                            </div>
                                            <div className="font-mono text-[11px] text-ink-500">
                                              {item.sku}
                                            </div>
                                          </div>
                                          <span className="shrink-0 text-[12px] text-ink-600">
                                            × {item.quantity}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                (row.firstItem?.quantity ?? 0) > 0 && (
                                  <span className="text-[11px] text-ink-500">
                                    × {row.firstItem?.quantity}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] text-ink-900">
                            {row.customer.name ?? '—'}
                          </div>
                          <div className="font-mono text-[11px] text-ink-500">
                            {row.customer.email ?? ''}
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle text-[12.5px] font-medium text-ink-900">
                        {humanizeMarketplace(row.marketplace) ?? row.pluginName ?? '—'}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                        {row.deliveryMode === 'pickup' ? (
                          <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                            Locker
                          </span>
                        ) : row.deliveryMode === 'courier' ? (
                          <span className="inline-flex items-center rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-700">
                            Curier
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle text-[12.5px] text-ink-600">
                        {formatDate(row.placedAt)}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                        {row.invoiceSeries ? (
                          <div className="flex items-center gap-3">
                            {/* Serie/număr — clicabilă dacă există PDF */}
                            {row.invoicePdfUrl ? (
                              <a
                                href={row.invoicePdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-[12px] font-medium text-primary underline"
                                data-testid={`invoice-number-${row.id}`}
                              >
                                {row.invoiceSeries}
                              </a>
                            ) : (
                              <span
                                className="font-mono text-[12px] font-medium text-ink-900"
                                data-testid={`invoice-number-${row.id}`}
                              >
                                {row.invoiceSeries}
                              </span>
                            )}
                            {row.invoiceStornoSeries ? (
                              <span
                                className="inline-flex items-center rounded-full bg-warning-bg px-2 py-0.5 text-[11px] text-warning"
                                data-testid={`invoice-storno-badge-${row.id}`}
                              >
                                Storno {row.invoiceStornoSeries}
                              </span>
                            ) : (
                              /* Acțiuni factură — ascunse într-un dropdown "···" */
                              <div
                                className="relative inline-block"
                                ref={openInvoiceMenu === row.id ? invoiceMenuRef : null}
                              >
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={pendingInvoice !== null}
                                  data-testid={`invoice-actions-${row.id}`}
                                  onClick={(): void => {
                                    setOpenInvoiceMenu(openInvoiceMenu === row.id ? null : row.id);
                                  }}
                                >
                                  {pendingInvoice?.orderId === row.id ? '...' : '···'}
                                </Button>
                                {openInvoiceMenu === row.id && (
                                  <div className="absolute left-0 z-20 mt-1 min-w-[130px] rounded-md border border-ink-200 bg-white py-1 shadow-lg">
                                    <button
                                      type="button"
                                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-50 disabled:opacity-50"
                                      disabled={pendingInvoice !== null}
                                      data-testid={`invoice-storno-${row.id}`}
                                      onClick={(): void => {
                                        setOpenInvoiceMenu(null);
                                        void handleStornoInvoice(row.id);
                                      }}
                                    >
                                      {pendingInvoice?.orderId === row.id &&
                                      pendingInvoice.action === 'storno'
                                        ? 'Stornare...'
                                        : 'Stornează'}
                                    </button>
                                    {row.marketplace?.startsWith('emag-') ? (
                                      <button
                                        type="button"
                                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-50 disabled:opacity-50"
                                        disabled={pendingInvoice !== null}
                                        data-testid={`invoice-storno-partial-${row.id}`}
                                        onClick={(): void => {
                                          setOpenInvoiceMenu(null);
                                          void openStornoPartial(row.id);
                                        }}
                                      >
                                        Storno parțial eMAG
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-ink-50 disabled:opacity-50"
                                      disabled={pendingInvoice !== null}
                                      data-testid={`invoice-delete-${row.id}`}
                                      onClick={(): void => {
                                        setOpenInvoiceMenu(null);
                                        void handleDeleteInvoice(row.id);
                                      }}
                                    >
                                      {pendingInvoice?.orderId === row.id &&
                                      pendingInvoice.action === 'delete'
                                        ? 'Ștergere...'
                                        : 'Șterge'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pendingInvoice !== null}
                            data-testid={`invoice-emit-${row.id}`}
                            onClick={(): void => {
                              void handleEmitInvoice(row.id);
                            }}
                          >
                            {pendingInvoice?.orderId === row.id && pendingInvoice.action === 'emit'
                              ? 'Se emite...'
                              : '+ Creare rapidă'}
                          </Button>
                        )}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                        {row.awbNumber ? (
                          <div className="flex items-center gap-2">
                            {row.awbTrackingUrl ? (
                              <a
                                href={row.awbTrackingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-[12px] font-medium text-primary underline"
                              >
                                {row.awbNumber}
                              </a>
                            ) : (
                              <span className="font-mono text-[12px] text-ink-700">
                                {row.awbNumber}
                              </span>
                            )}
                            {(row.awbHasTrendyolLabel === true || row.awbHasEmagLabel === true) && (
                              <button
                                type="button"
                                title="Descarcă PDF AWB"
                                disabled={downloadingAwbLabel !== null}
                                onClick={(): void => {
                                  void handleDownloadAwbLabel(
                                    row.id,
                                    row.awbHasEmagLabel ? 'emag' : 'trendyol',
                                  );
                                }}
                                className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-600 hover:border-ink-400 hover:text-ink-900 disabled:opacity-50"
                              >
                                {downloadingAwbLabel === row.id ? '…' : '↓ PDF'}
                              </button>
                            )}
                          </div>
                        ) : row.marketplace?.startsWith('emag-') ||
                          row.marketplace?.startsWith('fbe-') ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pendingAwb !== null}
                            data-testid={`awb-emit-${row.id}`}
                            onClick={(): void => {
                              void handleEmitAwb(row.id);
                            }}
                          >
                            {pendingAwb === row.id ? 'Se emite...' : '+ Creare rapidă'}
                          </Button>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium leading-none ${statusBadgeClasses(
                              row.status,
                            )}`}
                            data-testid={`order-status-${row.id}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${statusDotColor(row.status)}`}
                              aria-hidden="true"
                            />
                            {row.status}
                          </span>
                          {row.cancellationRequest !== null &&
                            row.cancellationRequest !== undefined && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 512 512"
                                className="h-[18px] w-[18px] shrink-0"
                                aria-label="Anulare solicitată"
                              >
                                <title>{`Anulare solicitată: ${row.cancellationRequest}`}</title>
                                <path
                                  fill="#ED2F2F"
                                  d="M255.313 20.625h2.78c15.613.036 30.59 1.146 45.907 4.375l2.687.551C346.52 33.965 382.649 53.085 413 80l1.669 1.478C456.574 118.81 482.442 170.6 490 226l.313 2.21c7.467 61.597-10.565 124.83-48.687 173.546C432.15 413.565 421.813 425.496 410 435l-3.219 2.691C397.658 445.244 388.13 451.87 378 458l-2.12 1.289c-36.02 21.627-77.351 32.175-119.192 32.086h-2.781c-15.616-.036-30.584-1.16-45.907-4.375l-2.654-.535c-39.3-8.131-76.873-27.161-106.24-54.512-1.904-1.765-3.86-3.42-5.856-5.078-43.844-38.452-68.475-97.704-72.746-154.95C17.33 220.194 30.17 165.28 61 123l1.363-1.885c5.546-7.643 11.202-15.059 17.649-21.974 1.778-1.915 3.445-3.881 5.113-5.891 41.839-47.706 107.724-72.759 170.188-72.625"
                                />
                                <path
                                  fill="#EDECF0"
                                  d="M262 113c5.952 2.533 9.983 6.344 13 12 1.155 3.466 1.138 6.172 1.154 9.83l.013 2.117c.014 2.347.02 4.693.026 7.04l.025 5.041c.026 5.525.041 11.049.055 16.574l.017 5.707q.033 11.875.051 23.75.023 17.007.107 34.016.056 11.963.063 23.927c.004 4.761.016 9.523.048 14.284q.044 6.725.025 13.45 0 2.46.025 4.923c.168 16.542.168 16.542-5.609 23.341-5.555 5.132-10.948 6.507-18.336 6.398-5.491-.82-9.516-3.713-12.941-7.994-4.96-7.537-4.422-15.426-4.354-24.088q-.008-2.525-.022-5.049c-.018-4.55-.005-9.098.014-13.648.017-4.771.008-9.543.003-14.314q-.006-12.015.04-24.03c.031-9.25.031-18.5.014-27.749-.016-8.914-.01-17.828.008-26.742q.01-5.68-.002-11.36-.01-6.69.032-13.383.01-2.45 0-4.9c-.06-15.345-.06-15.345 4.544-22.141 2.07-2.059 2.07-2.059 4.125-3.437l2.07-1.434c4.956-3.1 10.103-2.864 15.805-2.129M272.125 357.063c5.126 4.602 8.112 11.094 8.5 17.937-.384 6.96-3.648 12.542-7.937 17.875-6.134 4.85-11.099 6.767-19.008 6.45-6.12-.741-11.338-2.866-15.68-7.325-4.626-7.22-7.065-13.346-6-22 2.627-8.047 7.187-13.537 14.688-17.375 9.836-1.856 17.114-1.056 25.437 4.438"
                                />
                              </svg>
                            )}
                        </div>
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle text-[12.5px] text-ink-700">
                        {humanizePaymentMode(row.paymentModeId)}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 text-right align-middle font-mono tabular-nums text-[13px] font-medium text-ink-900">
                        {formatTotal(
                          row.deliveryMode === 'pickup' && row.shippingCost
                            ? {
                                amountMinor: String(
                                  Number(row.total.amountMinor) -
                                    Number(row.shippingCost.amountMinor),
                                ),
                                currency: row.total.currency,
                              }
                            : row.total,
                        )}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 text-right align-middle">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/orders/${row.id}`}>Detalii</Link>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[12px] text-ink-500" data-testid="orders-pagination-info">
            Pagina {page} din {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={(): void => goToPage(page - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={(): void => goToPage(page + 1)}
            >
              Următor
            </Button>
          </div>
        </div>
      </div>

      {/* ── Dialog storno parțial eMAG ─────────────────────────────────────── */}
      {stornoPartial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">Storno parțial eMAG</h2>

            {stornoPartial.loading ? (
              <p className="text-sm text-ink-500">Se încarcă produsele...</p>
            ) : stornoPartial.products.length === 0 ? (
              <p className="text-sm text-ink-500">Nu există produse active pe această comandă.</p>
            ) : (
              <div className="mb-4 space-y-3">
                <p className="text-xs text-ink-500">
                  Setează cantitatea returnată pentru fiecare produs (0 = returnat complet).
                </p>
                {stornoPartial.products.map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="flex-1 truncate text-sm" title={p.name}>
                      {p.name}
                    </span>
                    <span className="shrink-0 text-xs text-ink-400">din {p.currentQty}</span>
                    <input
                      type="number"
                      min={0}
                      max={p.currentQty}
                      value={p.returnQty}
                      onChange={(e): void => {
                        const val = Math.max(
                          0,
                          Math.min(p.currentQty, parseInt(e.target.value, 10) || 0),
                        );
                        setStornoPartial((s) =>
                          s
                            ? {
                                ...s,
                                products: s.products.map((x) =>
                                  x.id === p.id ? { ...x, returnQty: val } : x,
                                ),
                              }
                            : null,
                        );
                      }}
                      className="w-16 rounded border border-ink-300 px-2 py-1 text-right text-sm"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={stornoPartial.submitting}
                onClick={(): void => setStornoPartial(null)}
              >
                Anulează
              </Button>
              <Button
                size="sm"
                disabled={
                  stornoPartial.loading ||
                  stornoPartial.submitting ||
                  stornoPartial.products.length === 0
                }
                onClick={(): void => void submitStornoPartial()}
              >
                {stornoPartial.submitting ? 'Se trimite...' : 'Confirmă storno parțial'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
