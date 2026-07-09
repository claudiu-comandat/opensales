import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CancelOrderButton } from './cancel-order-button.js';
import { DeleteOrderButton } from './delete-order-button.js';
import { ManualMatchingButton } from './manual-matching.js';
import { OrderActions } from './order-actions.js';
import { SubstituteButton } from './substitute-item.js';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-types';
import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

interface OrderItem {
  id: string;
  productId: string | null;
  sku: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: { amountMinor: string; currency: string };
  total: { amountMinor: string; currency: string };
  attributes: Record<string, unknown>;
  substitution: {
    originalSku: string;
    originalName: string;
    originalProductId: string | null;
    substitutedAt: string;
  } | null;
}

interface MoneyValue {
  amountMinor: string;
  currency: string;
}

interface OrderDetail {
  id: string;
  externalId: string;
  pluginId: string | null;
  marketplace: string | null;
  deliveryMode: string | null;
  status: string;
  total: MoneyValue;
  shippingCost: MoneyValue | null;
  tax: MoneyValue | null;
  vouchers: MoneyValue | null;
  paymentStatus: string | null;
  refundedAmount: MoneyValue | null;
  deliveryLocation: { name?: string; type?: string; courier_name?: string } | null;
  finalizedAt: string | null;
  attachments: { name: string; url: string; type?: number }[] | null;
  customer: { email: string | null; phone: string | null; name: string | null };
  billingAddress: Record<string, unknown>;
  shippingAddress: Record<string, unknown>;
  awbOutgoing: {
    number: string;
    pdf_url?: string;
    tracking_url?: string;
    status: string;
    issued_at: string;
  } | null;
  awbReturn: unknown;
  invoice: unknown;
  invoiceStorno: unknown;
  placedAt: string;
  createdAt: string;
  updatedAt: string;
  items?: OrderItem[];
  hasUnmatchedItems: boolean;
  rawPayload: unknown;
}

function formatMoney(value: { amountMinor: string; currency: string }): string {
  const amount = Number(value.amountMinor) / 100;
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: value.currency,
  }).format(amount);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // Ancorat la Europe/Bucharest: pagina e randată server-side (fus sistem = UTC în
  // producție), deci fără timeZone explicit ar afișa ora UTC, nu ora locală RO.
  return date.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
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
    case 'cancelled':
    case 'refunded':
    case 'returned':
      return 'bg-danger-bg text-danger';
    default:
      return 'bg-ink-100 text-ink-700';
  }
}

function AddressBlock({
  title,
  address,
}: {
  title: string;
  address: Record<string, unknown>;
}): ReactElement {
  const fields = [
    'name',
    'company',
    'street',
    'street2',
    'city',
    'county',
    'zip',
    'country',
    'phone',
    'email',
    'vat_id',
  ];
  const hasAny = fields.some((f) => address[f] !== undefined && address[f] !== null);
  return (
    <div
      data-testid={`address-${title}`}
      className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm"
    >
      <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink-50 text-ink-700">
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
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
        </div>
        <div className="text-[13.5px] font-medium text-ink-900">{title}</div>
      </div>
      <div className="space-y-1.5 p-4 text-[13px]">
        {!hasAny ? (
          <span className="italic text-ink-500">Nicio adresă</span>
        ) : (
          fields.map((f) => {
            const raw = address[f];
            if (raw === undefined || raw === null) return null;
            const text =
              typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
                ? String(raw)
                : JSON.stringify(raw);
            return (
              <div key={f} className="flex justify-between gap-4">
                <span className="capitalize text-ink-500">{f.replace('_', ' ')}</span>
                <span className="text-right font-medium text-ink-900">{text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;

  let order: OrderDetail;
  try {
    order = await (await getServerApiClient()).get<OrderDetail>(`/orders/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const items = (order.items ?? []).filter(
    (it) => !(it.sku === 'TRANSPORT' && order.deliveryMode === 'pickup'),
  );

  const unmatchedItems = items.filter(
    (it) => it.productId === null && it.sku !== 'TRANSPORT' && it.sku !== 'VOUCHER',
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/orders">
            <span aria-hidden="true">‹</span>
            Comenzi
          </Link>
        </Button>
        <div className="flex-1" />
        {order.pluginId === null && <DeleteOrderButton orderId={order.id} />}
      </div>

      {/* Alert produse neidentificate */}
      {order.hasUnmatchedItems && unmatchedItems.length > 0 ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-warning bg-warning-bg px-4 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-warning"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <div className="text-[13px] text-warning">
            <span className="font-semibold">
              {unmatchedItems.length}{' '}
              {unmatchedItems.length === 1 ? 'produs neidentificat' : 'produse neidentificate'}
            </span>{' '}
            — factura nu poate fi emisă până la identificarea lor. Folosește butonul{' '}
            <strong>Manual Matching</strong> din secțiunea Articole.
          </div>
        </div>
      ) : null}

      {/* Compact header */}
      <div className="rounded-[18px] border border-ink-200 bg-surface px-[18px] py-3 shadow-os-sm">
        <div className="flex flex-wrap items-center gap-3" style={{ minHeight: 36 }}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500">
            {order.marketplace ?? order.pluginId}
          </span>
          <span className="text-[14px] text-ink-300">·</span>
          <span
            className="font-mono text-[18px] font-bold tracking-[-0.01em] text-ink-900"
            data-testid="order-external-id"
          >
            #{order.externalId}
          </span>
          <span className="text-[14px] text-ink-300">·</span>
          <span className="text-[13px] text-ink-600">{formatDate(order.placedAt)}</span>
          <span className="text-[14px] text-ink-300">·</span>
          <span
            className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium leading-none ${statusBadgeClasses(
              order.status,
            )}`}
            data-testid="order-status"
          >
            {order.status}
          </span>
          <div className="flex-1" />
          <CancelOrderButton
            orderId={order.id}
            marketplace={order.marketplace ?? undefined}
            status={order.status}
          />
        </div>
      </div>

      {/* Summary */}
      <div
        data-testid="order-summary"
        className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm"
      >
        <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-brand-50 text-brand-700">
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
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="6" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <div className="text-[13.5px] font-medium text-ink-900">Sumar</div>
        </div>
        <div className="grid grid-cols-2 gap-4 p-4 text-[13px]">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
              Client
            </div>
            <div className="font-medium text-ink-900">{order.customer.name ?? '—'}</div>
            {order.customer.email ? (
              <div className="text-[11px] text-ink-500">{order.customer.email}</div>
            ) : null}
            {order.customer.phone ? (
              <div className="text-[11px] text-ink-500">{order.customer.phone}</div>
            ) : null}
            {order.deliveryLocation?.name ? (
              <div className="mt-1 flex items-center gap-1 text-[11px] text-ink-600">
                <span>📦</span>
                <span>{order.deliveryLocation.name}</span>
                {order.deliveryLocation.courier_name ? (
                  <span className="text-ink-400">· {order.deliveryLocation.courier_name}</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="space-y-1 text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
              Total
            </div>
            <div
              className="font-mono text-[18px] font-bold tabular-nums text-ink-900"
              data-testid="order-total"
            >
              {formatMoney(
                order.deliveryMode === 'pickup' && order.shippingCost
                  ? {
                      amountMinor: String(
                        Number(order.total.amountMinor) - Number(order.shippingCost.amountMinor),
                      ),
                      currency: order.total.currency,
                    }
                  : order.total,
              )}
            </div>
            {order.shippingCost && order.deliveryMode !== 'pickup' ? (
              <div className="text-[11px] text-ink-500">
                Transport: {formatMoney(order.shippingCost)}
              </div>
            ) : null}
            {order.tax && Number(order.tax.amountMinor) > 0 ? (
              <div className="text-[11px] text-ink-500">TVA: {formatMoney(order.tax)}</div>
            ) : null}
            {order.vouchers && Number(order.vouchers.amountMinor) > 0 ? (
              <div className="text-[11px] text-green-700">
                Voucher: -{formatMoney(order.vouchers)}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-0.5">
              {order.paymentStatus ? (
                <span
                  className={`inline-flex h-[18px] items-center rounded-full px-2 text-[10px] font-medium ${order.paymentStatus === 'paid' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}
                >
                  {order.paymentStatus === 'paid' ? 'Plătit' : 'Neramburat'}
                </span>
              ) : null}
              {order.refundedAmount && Number(order.refundedAmount.amountMinor) > 0 ? (
                <span className="text-[11px] text-danger">
                  Rambursat: {formatMoney(order.refundedAmount)}
                </span>
              ) : null}
            </div>
            {order.finalizedAt ? (
              <div className="text-[10px] text-ink-400">
                Finalizat: {formatDate(order.finalizedAt)}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AddressBlock title="Adresă facturare" address={order.billingAddress} />
        <AddressBlock title="Adresă livrare" address={order.shippingAddress} />
      </div>

      {/* Items card */}
      <div className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm">
        <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink-50 text-ink-700">
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
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
          </div>
          <div className="text-[13.5px] font-medium text-ink-900">Articole</div>
          {unmatchedItems.length > 0 ? (
            <div className="ml-auto">
              <ManualMatchingButton orderId={order.id} unmatchedItems={unmatchedItems} />
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  &nbsp;
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  SKU
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-left text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Nume
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-right text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Cant.
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-right text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Preț unitar
                </th>
                <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-right text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                  Total
                </th>
                {order.marketplace !== null ? (
                  <th className="whitespace-nowrap border-b border-ink-200 bg-ink-50 px-[14px] py-[10px] text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-500">
                    &nbsp;
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={order.marketplace !== null ? 7 : 6}
                    className="px-[14px] py-8 text-center text-[13px] text-ink-500"
                    data-testid="items-empty"
                  >
                    Niciun articol.
                  </td>
                </tr>
              ) : (
                items.map((it) => {
                  const isUnmatched =
                    it.productId === null && it.sku !== 'TRANSPORT' && it.sku !== 'VOUCHER';
                  const isVirtual = it.sku === 'TRANSPORT' || it.sku === 'VOUCHER';
                  const isSubstituted = it.substitution !== null;
                  return (
                    <tr
                      key={it.id}
                      data-testid={`item-row-${it.id}`}
                      className={`transition-colors hover:[&>td]:bg-ink-50 ${isUnmatched ? '[&>td]:bg-warning-bg/30' : ''}`}
                    >
                      <td className="border-b border-ink-100 px-[14px] py-2 align-middle">
                        {it.imageUrl !== null ? (
                          // img intentional — external marketplace URLs; Next Image requires domain allowlist
                          <img
                            src={it.imageUrl}
                            alt={it.name}
                            className="h-10 w-10 rounded border border-ink-200 object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded border border-dashed text-[10px] ${isUnmatched ? 'border-warning text-warning' : 'border-ink-200 text-ink-400'}`}
                          >
                            {isUnmatched ? '!' : '—'}
                          </div>
                        )}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle font-mono text-[12.5px] text-ink-900">
                        {it.sku}
                        {isUnmatched ? (
                          <span className="ml-1.5 inline-flex h-4 items-center rounded-full bg-warning px-1.5 text-[9px] font-bold uppercase tracking-wide text-white">
                            neidentificat
                          </span>
                        ) : null}
                        {isSubstituted ? (
                          <span className="ml-1.5 inline-flex h-4 items-center rounded-full bg-brand-100 px-1.5 text-[9px] font-bold uppercase tracking-wide text-brand-700">
                            modificat
                          </span>
                        ) : null}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 align-middle text-ink-800">
                        {it.name}
                        {isSubstituted && it.substitution ? (
                          <div className="mt-0.5 text-[11px] text-ink-400 line-through">
                            {it.substitution.originalName}
                          </div>
                        ) : null}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 text-right align-middle font-mono tabular-nums text-[13px] text-ink-900">
                        {it.quantity}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 text-right align-middle font-mono tabular-nums text-[13px] text-ink-900">
                        {formatMoney(it.unitPrice)}
                      </td>
                      <td className="border-b border-ink-100 px-[14px] py-3 text-right align-middle font-mono tabular-nums text-[13px] font-medium text-ink-900">
                        {formatMoney(it.total)}
                      </td>
                      {order.marketplace !== null ? (
                        <td className="border-b border-ink-100 px-[10px] py-3 align-middle">
                          {!isVirtual ? (
                            <SubstituteButton
                              orderId={order.id}
                              item={{
                                id: it.id,
                                sku: it.sku,
                                name: it.name,
                                quantity: it.quantity,
                                unitPrice: it.unitPrice,
                              }}
                            />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Attachments (multiple documents from marketplace) */}
      {order.attachments && order.attachments.length > 1 ? (
        <div className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm">
          <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink-50 text-ink-700">
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
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </div>
            <div className="text-[13.5px] font-medium text-ink-900">Documente atașate</div>
          </div>
          <div className="divide-y divide-ink-100">
            {order.attachments.map((att, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                <span className="text-ink-700">{att.name || `Document ${idx + 1}`}</span>
                <a
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline text-[12px]"
                >
                  Descarcă
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <OrderActions
        orderId={order.id}
        marketplace={order.marketplace ?? undefined}
        awbOutgoing={order.awbOutgoing}
        awbReturn={order.awbReturn}
        invoice={order.invoice}
        invoiceStorno={order.invoiceStorno}
        canStorno={!!order.invoice && !order.invoiceStorno}
      />

      {/* Raw payload from marketplace */}
      {order.rawPayload !== null && order.rawPayload !== undefined ? (
        <details className="overflow-hidden rounded-[18px] border border-ink-200 bg-surface shadow-os-sm">
          <summary className="flex cursor-pointer list-none items-center gap-3 border-b border-ink-100 px-4 py-3 hover:bg-ink-50">
            <div className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink-50 text-ink-500">
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
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div className="text-[13.5px] font-medium text-ink-700">
              Date brute primite de la marketplace
            </div>
            <span className="ml-auto text-[11px] text-ink-400">▸ expand</span>
          </summary>
          <pre className="max-h-[600px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-ink-700">
            {JSON.stringify(order.rawPayload, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
