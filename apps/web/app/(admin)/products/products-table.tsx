'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ImportBatchIndicator, type ActiveImportBatch } from './import-batch-indicator.js';
import { ImportSourceDropdown, type ImportSourcePlugin } from './import-source-dropdown.js';

import type { ChangeEvent, ReactElement } from 'react';

import { MPLogo, packageToLogoName } from '@/components/mp-logo';
import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';
import { MARKETPLACES, marketplaceLabel } from '@/lib/marketplace-catalog';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ListingInfo {
  id: string;
  pluginId: string;
  pluginPackage: string;
  platform: string;
  status: string;
  syncState?: Record<string, unknown>;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  price: { amountMinor: string; currency: string };
  stockQuantity: number;
  isActive: boolean;
  images: { url: string }[];
  listings: ListingInfo[];
}

interface GlobalStats {
  totalProducts: number;
  totalStock: number;
  lowStockCount: number;
  noStockCount: number;
}

interface ProductsTableProps {
  rows: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  isActive: string;
  marketplace: string;
  listingStatus: string;
  relevantOnly: boolean;
  globalStats: GlobalStats;
  plugins?: ImportSourcePlugin[];
  activeBatch?: ActiveImportBatch | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type CouplingState = 'full' | 'partial' | 'unlinked';

function getCouplingState(listings: ListingInfo[]): CouplingState {
  if (listings.length === 0) return 'unlinked';
  if (listings.every((l) => l.status === 'active')) return 'full';
  return 'partial';
}

const MARKETPLACE_NAMES: Record<string, string> = {
  emag: 'eMAG',
  trendyol: 'Trendyol',
  temu: 'Temu',
};

// ── CouplingBadge ──────────────────────────────────────────────────────────────

function CouplingBadge({ state }: { state: CouplingState }): ReactElement {
  const map = {
    full: {
      label: 'Cuplat complet',
      bg: 'rgba(34,197,94,0.85)',
      fg: '#fff',
      dot: 'rgba(255,255,255,0.8)',
    },
    partial: {
      label: 'Cuplat parțial',
      bg: 'rgba(234,179,8,0.85)',
      fg: '#fff',
      dot: 'rgba(255,255,255,0.8)',
    },
    unlinked: {
      label: 'Necuplat',
      bg: 'rgba(11,13,18,0.55)',
      fg: 'rgba(255,255,255,0.85)',
      dot: 'rgba(255,255,255,0.5)',
    },
  } as const;
  const m = map[state];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 9px',
        borderRadius: 6,
        fontSize: 10.5,
        fontWeight: 600,
        background: m.bg,
        color: m.fg,
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(6px)',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot }} />
      {m.label}
    </span>
  );
}

// ── ChannelState ───────────────────────────────────────────────────────────────

interface ChannelState {
  id: string;
  listingId: string;
  logo: string;
  label: string;
  pluginPackage: string;
  status: string;
  price: number;
  currency: string;
}

// ── ProductCard ────────────────────────────────────────────────────────────────

interface ProductCardProps {
  row: ProductRow;
  open: boolean;
  busy: boolean;
  onToggle: (open: boolean) => void;
  onDelete: () => void;
  onRefresh: () => void;
}

function ProductCard({
  row,
  open,
  busy,
  onToggle,
  onDelete,
  onRefresh: _onRefresh,
}: ProductCardProps): ReactElement {
  const [localTitle, setLocalTitle] = useState(row.name);
  const [titleFocused, setTitleFocused] = useState(false);
  const [localPrice, setLocalPrice] = useState(() => Number(row.price.amountMinor) / 100);
  const [priceFocused, setPriceFocused] = useState(false);
  const [localStock, setLocalStock] = useState(row.stockQuantity);
  const [stockFocused, setStockFocused] = useState(false);
  const [channels, setChannels] = useState<ChannelState[]>(() =>
    row.listings.map((l) => {
      const logo = packageToLogoName(l.pluginPackage);
      const minor = l.syncState?.price_amount_minor;
      const price =
        typeof minor === 'string' || typeof minor === 'number'
          ? Number(minor) / 100
          : Number(row.price.amountMinor) / 100;
      const currency =
        typeof l.syncState?.price_currency === 'string'
          ? l.syncState.price_currency
          : row.price.currency;
      return {
        id: l.platform || logo,
        listingId: l.id,
        logo,
        label: l.platform ? marketplaceLabel(l.platform) : (MARKETPLACE_NAMES[logo] ?? logo),
        pluginPackage: l.pluginPackage,
        status: l.status,
        price,
        currency,
      };
    }),
  );

  const couplingState = getCouplingState(row.listings);
  const activeChannels = channels.filter((c) => c.status === 'active');
  // Activ = cel puțin un canal activ; altfel Inactiv
  const isEffectivelyActive = activeChannels.length > 0;
  // Show all channels (including inactive) so platform icons are always visible
  const shownChannels = channels.length <= 4 ? channels : channels.slice(0, 3);
  const extraCount = channels.length > 4 ? channels.length - 3 : 0;

  const setChan = (id: string, patch: Partial<ChannelState>): void =>
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  async function saveName(): Promise<void> {
    if (localTitle === row.name) return;
    try {
      await getApiClient().patch(`/products/${row.id}`, { name: localTitle });
    } catch {
      setLocalTitle(row.name);
    }
  }

  async function savePrice(): Promise<void> {
    const newMinor = Math.round(localPrice * 100);
    if (newMinor === Number(row.price.amountMinor)) return;
    try {
      await getApiClient().patch(`/products/${row.id}`, { priceAmountMinor: newMinor });
    } catch {
      setLocalPrice(Number(row.price.amountMinor) / 100);
    }
  }

  async function saveStock(): Promise<void> {
    if (localStock === row.stockQuantity) return;
    try {
      await getApiClient().patch(`/products/${row.id}`, { stockQuantity: localStock });
    } catch {
      setLocalStock(row.stockQuantity);
    }
  }

  const imageUrl = (row.images as { url: string }[] | undefined)?.[0]?.url;

  return (
    <div
      data-testid={`product-row-${row.sku}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 18,
        border: '1px solid var(--ink-200, #e5e7eb)',
        background: 'var(--surface, #fff)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        cursor: open ? 'default' : 'pointer',
        padding: 0,
      }}
      onClick={(e): void => {
        if (open) return;
        const target = e.target as Element;
        if (target.closest('button, input, select, label, textarea, a')) return;
        onToggle(true);
      }}
    >
      {/* ── Image + overlays ── */}
      <div style={{ position: 'relative' }}>
        {/* Clickable image area — navigates to product page */}
        <Link
          href={`/products/${row.id}/edit`}
          style={{ display: 'block', textDecoration: 'none' }}
          onClick={(e): void => e.stopPropagation()}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '1 / 1',
              background: '#0b0d12',
              flexShrink: 0,
            }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={localTitle}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'rgba(255,255,255,0.3)',
                }}
              >
                Fără imagine
              </div>
            )}

            {/* Top-left: coupling badge */}
            <div style={{ position: 'absolute', top: 10, left: 10 }}>
              <CouplingBadge state={couplingState} />
            </div>

            {/* Top-right: activ/inactiv badge (derivat din canale active) */}
            <span
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 9px',
                borderRadius: 6,
                fontSize: 10.5,
                fontWeight: 600,
                background: isEffectivelyActive ? 'rgba(34,197,94,0.85)' : 'rgba(11,13,18,0.6)',
                color: '#fff',
                backdropFilter: 'blur(6px)',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: isEffectivelyActive ? '#fff' : 'rgba(255,255,255,0.45)',
                }}
              />
              {isEffectivelyActive ? 'Activ' : 'Inactiv'}
            </span>
          </div>
        </Link>

        {/* Title + SKU overlay — sits OUTSIDE <Link> so clicking textarea
            doesn't trigger navigation. pointerEvents:none on the wrapper
            lets clicks on the gradient pass through to the Link beneath. */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '36px 12px 12px',
            background:
              'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)',
            pointerEvents: 'none',
          }}
        >
          {/* Blur layer with fade mask */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              maskImage: 'linear-gradient(to top, black 0%, black 55%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to top, black 0%, black 55%, transparent 100%)',
            }}
          />

          {/* Editable title textarea — re-enables pointer events just for itself */}
          <div style={{ position: 'relative', pointerEvents: 'auto' }}>
            <textarea
              rows={2}
              value={localTitle}
              onChange={(e): void => setLocalTitle(e.target.value)}
              onFocus={(): void => {
                setTitleFocused(true);
                onToggle(true);
              }}
              onBlur={(): void => {
                setTitleFocused(false);
                void saveName();
              }}
              onClick={(e): void => e.stopPropagation()}
              style={{
                width: '100%',
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 14,
                fontWeight: 600,
                color: '#fff',
                lineHeight: 1.35,
                padding: 0,
                margin: 0,
                overflow: 'hidden',
                display: 'block',
                borderBottom: titleFocused
                  ? '1px solid rgba(255,255,255,0.45)'
                  : '1px solid transparent',
                cursor: 'text',
                transition: 'border-color .15s',
              }}
            />
          </div>

          <div
            style={{
              position: 'relative',
              fontSize: 13,
              color: 'rgba(255,255,255,0.85)',
              marginTop: 4,
              fontFamily: 'ui-monospace, monospace',
              letterSpacing: '0.02em',
            }}
          >
            {row.sku}
          </div>
        </div>
      </div>

      {/* ── Info strip: price + stock + channel logos ── */}
      <div
        style={{
          padding: '12px 14px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
        }}
      >
        {/* Price + Stock */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          {/* Price — inline editable */}
          <div>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--ink-500, #6b7280)',
                marginBottom: 2,
              }}
            >
              Preț
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <input
                type="number"
                step="0.01"
                value={localPrice}
                onChange={(e): void => setLocalPrice(parseFloat(e.target.value || '0'))}
                onFocus={(): void => {
                  setPriceFocused(true);
                  onToggle(true);
                }}
                onBlur={(): void => {
                  setPriceFocused(false);
                  void savePrice();
                }}
                onClick={(e): void => e.stopPropagation()}
                style={{
                  width: 68,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  color: 'var(--ink-900, #0b0d12)',
                  borderBottom: priceFocused
                    ? '1px solid var(--ink-400, #9ca3af)'
                    : '1px solid transparent',
                  padding: 0,
                  transition: 'border-color .15s',
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: 'var(--ink-400, #9ca3af)',
                  lineHeight: 1,
                }}
              >
                {row.price.currency}
              </span>
            </div>
          </div>

          {/* Stock — inline editable */}
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--ink-500, #6b7280)',
                marginBottom: 2,
              }}
            >
              Stoc
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'flex-end',
                gap: 3,
              }}
            >
              <input
                type="number"
                value={localStock}
                onChange={(e): void => setLocalStock(parseInt(e.target.value || '0', 10))}
                onFocus={(): void => {
                  setStockFocused(true);
                  onToggle(true);
                }}
                onBlur={(): void => {
                  setStockFocused(false);
                  void saveStock();
                }}
                onClick={(e): void => e.stopPropagation()}
                style={{
                  width: 42,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'right',
                  color:
                    localStock === 0
                      ? 'var(--danger, #ef4444)'
                      : localStock < 5
                        ? 'var(--warning, #f59e0b)'
                        : 'var(--ink-900, #0b0d12)',
                  borderBottom: stockFocused
                    ? '1px solid var(--ink-400, #9ca3af)'
                    : '1px solid transparent',
                  padding: 0,
                  transition: 'border-color .15s',
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: 'var(--ink-400, #9ca3af)',
                  lineHeight: 1,
                }}
              >
                buc
              </span>
            </div>
          </div>
        </div>

        {/* Active channel logos */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            alignItems: 'center',
            opacity: isEffectivelyActive ? 1 : 0.35,
            transition: 'opacity .2s',
          }}
        >
          {shownChannels.map((c) => (
            <span key={c.id} title={c.label}>
              <MPLogo name={c.logo} size={16} />
            </span>
          ))}
          {extraCount > 0 && (
            <span
              style={{
                height: 16,
                minWidth: 20,
                borderRadius: 4,
                padding: '0 4px',
                background: 'var(--ink-100, #f3f4f6)',
                color: 'var(--ink-600, #4b5563)',
                fontSize: 9.5,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +{extraCount}
            </span>
          )}
        </div>
      </div>

      {/* ── Toggle "Editare rapidă" button ── */}
      <button
        type="button"
        onClick={(e): void => {
          e.stopPropagation();
          onToggle(!open);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '9px 12px',
          border: 'none',
          borderTop: '1px solid var(--ink-100, #f3f4f6)',
          background: open ? 'var(--ink-50, #f9fafb)' : 'transparent',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 11.5,
          color: 'var(--ink-600, #4b5563)',
          fontWeight: 500,
          width: '100%',
        }}
      >
        {open ? 'Închide' : 'Editare rapidă'}
        {open ? (
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
            <path d="m18 15-6-6-6 6" />
          </svg>
        ) : (
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
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {/* ── Expanded "Canal & Preț" panel ── */}
      {open ? (
        <div
          style={{
            padding: '12px 14px 14px',
            background: 'var(--ink-50, #f9fafb)',
            borderTop: '1px solid var(--ink-100, #f3f4f6)',
          }}
          onClick={(e): void => e.stopPropagation()}
        >
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--ink-500, #6b7280)',
              marginBottom: 10,
            }}
          >
            Canal & Preț
          </div>

          {channels.length === 0 ? (
            <div
              style={{
                borderRadius: 10,
                border: '1.5px dashed var(--ink-300, #d1d5db)',
                background: 'var(--surface, #fff)',
                padding: 12,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--ink-500, #6b7280)',
              }}
            >
              Niciun canal conectat încă.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 240,
                overflowY: 'auto',
                overflowX: 'hidden',
              }}
            >
              {channels.map((c) => {
                const isPending = c.status === 'pending_approval';
                const effectiveActive = c.status === 'active' || isPending;
                const isError = c.status === 'error';
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: 'var(--surface, #fff)',
                      border: '1px solid var(--ink-200, #e5e7eb)',
                      flexShrink: 0,
                    }}
                  >
                    {/* Icon — fixed 56px container, all logos aceeasi latime */}
                    <div
                      style={{
                        width: 56,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      <MPLogo name={c.logo} size={16} />
                    </div>

                    {/* Price — flex, aliniat dreapta */}
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 4,
                        background: 'var(--ink-100, #f3f4f6)',
                        borderRadius: 8,
                        padding: '5px 8px',
                        border: '1px solid var(--ink-200, #e5e7eb)',
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: 'var(--ink-400, #9ca3af)',
                          letterSpacing: '0.03em',
                          flexShrink: 0,
                        }}
                      >
                        {c.currency}
                      </span>
                      <input
                        type="number"
                        value={c.price}
                        onChange={(e): void =>
                          setChan(c.id, { price: parseFloat(e.target.value || '0') })
                        }
                        style={{
                          width: 52,
                          border: 'none',
                          outline: 'none',
                          background: 'transparent',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--ink-900, #0b0d12)',
                          textAlign: 'right',
                          padding: 0,
                          flexShrink: 0,
                        }}
                      />
                    </div>

                    {/* Toggle — aliniat dreapta, latime fixa */}
                    <label
                      style={{
                        position: 'relative',
                        display: 'inline-block',
                        width: 38,
                        height: 22,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={effectiveActive}
                        onChange={(e): void => {
                          const wantActive = e.target.checked;
                          const prevStatus = c.status;
                          setChan(c.id, { status: wantActive ? 'active' : 'paused' });
                          void getApiClient()
                            .patch(`/listings/${c.listingId}/active`, { active: wantActive })
                            .catch((): void => {
                              setChan(c.id, { status: prevStatus });
                            });
                        }}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: 11,
                          background: effectiveActive
                            ? isPending
                              ? 'var(--warning, #f59e0b)'
                              : 'var(--brand-600, #3b5bff)'
                            : isError
                              ? 'var(--danger, #ef4444)'
                              : 'var(--ink-300, #d1d5db)',
                          transition: 'background .2s',
                        }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          top: 3,
                          left: effectiveActive ? 19 : 3,
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: '#fff',
                          transition: 'left .18s',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
            <Button type="button" variant="ghost" size="sm" onClick={(): void => onToggle(false)}>
              Anulează
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/products/${row.id}/edit`}>Editează</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onDelete}
              data-testid={`product-delete-${row.sku}`}
            >
              Șterge
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── ProductsTable ──────────────────────────────────────────────────────────────

export function ProductsTable({
  rows,
  total,
  page,
  pageSize,
  search,
  isActive,
  marketplace,
  listingStatus,
  relevantOnly,
  globalStats,
  plugins = [],
  activeBatch = null,
}: ProductsTableProps): ReactElement {
  const router = useRouter();
  const sp = useSearchParams();
  // Keep a ref so the search effect always reads the latest params without
  // having sp in its dependency array (which would reset pagination on every
  // page navigation — sp changes → effect fires → page param deleted → page 1).
  const spRef = useRef(sp);
  spRef.current = sp;
  const [searchValue, setSearchValue] = useState(search);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const initialMount = useRef(true);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleDeleteAll(): Promise<void> {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Șterge TOATE cele ${globalStats.totalProducts} produse? Acțiunea este DEFINITIVĂ și nu poate fi anulată.`,
      );
      if (!ok) return;
    }
    setBusyId('__all__');
    setDeleteError(null);
    try {
      await getApiClient().delete('/products');
      router.refresh();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Eroare la ștergere.';
      setDeleteError(message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, sku: string): Promise<void> {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Șterge produsul "${sku}"? Acțiunea este definitivă.`);
      if (!ok) return;
    }
    setBusyId(id);
    setDeleteError(null);
    try {
      await getApiClient().delete(`/products/${id}`);
      router.refresh();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Eroare la ștergere.';
      setDeleteError(message);
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    const handle = setTimeout(() => {
      const params = new URLSearchParams(Array.from(spRef.current.entries()));
      if (searchValue) {
        params.set('search', searchValue);
        params.set('relevantOnly', 'false');
      } else {
        params.delete('search');
        params.delete('relevantOnly');
      }
      params.delete('page');
      router.replace(`/products?${params.toString()}`);
    }, 300);
    return (): void => {
      clearTimeout(handle);
    };
  }, [searchValue, router]);

  function handleRelevantOnlyChange(event: ChangeEvent<HTMLInputElement>): void {
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (event.target.checked) {
      params.delete('relevantOnly');
    } else {
      params.set('relevantOnly', 'false');
    }
    params.delete('page');
    router.replace(`/products?${params.toString()}`);
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (value === '') {
      params.delete('isActive');
    } else {
      params.set('isActive', value);
    }
    params.delete('page');
    router.replace(`/products?${params.toString()}`);
  }

  function handleMarketplaceChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (value === '') {
      params.delete('marketplace');
    } else {
      params.set('marketplace', value);
    }
    params.delete('page');
    router.replace(`/products?${params.toString()}`);
  }

  function handleListingStatusChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    const params = new URLSearchParams(Array.from(sp.entries()));
    if (value === '') {
      params.delete('listingStatus');
    } else {
      params.set('listingStatus', value);
    }
    params.delete('page');
    router.replace(`/products?${params.toString()}`);
  }

  function goToPage(target: number): void {
    const params = new URLSearchParams(Array.from(sp.entries()));
    params.set('page', String(target));
    router.replace(`/products?${params.toString()}`);
  }

  const kpiCards: readonly { l: string; v: number; s: string; warn?: boolean }[] = [
    { l: 'Total produse', v: globalStats.totalProducts, s: 'În catalog' },
    { l: 'Stoc total', v: globalStats.totalStock, s: 'Bucăți disponibile' },
    { l: 'Stoc critic', v: globalStats.lowStockCount, s: 'Sub 5 bucăți', warn: true },
    { l: 'Fără stoc', v: globalStats.noStockCount, s: 'Indisponibil', warn: true },
  ];

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpiCards.map((s) => (
            <div
              key={s.l}
              className="flex flex-col gap-1 rounded-[18px] border border-ink-200 bg-surface p-4 shadow-os-sm"
            >
              <div className="text-[12px] text-ink-500">{s.l}</div>
              <div
                className={`text-[24px] font-semibold tabular-nums tracking-[-0.02em] ${
                  s.warn === true ? 'text-warning' : 'text-ink-900'
                }`}
              >
                {s.v}
              </div>
              <div className="text-[11px] text-ink-500">{s.s}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] w-full max-w-sm flex-1">
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
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              aria-label="Caută produse"
              placeholder="Caută după nume, SKU sau EAN..."
              value={searchValue}
              onChange={(e): void => setSearchValue(e.target.value)}
              className="h-9 w-full rounded-[10px] border border-ink-200 bg-surface pl-9 pr-3 text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
            />
          </div>
          <select
            aria-label="Filtru status"
            value={isActive}
            onChange={handleStatusChange}
            className="h-9 rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
          >
            <option value="">Toate</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          <select
            aria-label="Filtru marketplace"
            value={marketplace}
            onChange={handleMarketplaceChange}
            className="h-9 rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
          >
            <option value="">Toate ofertele</option>
            {MARKETPLACES.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtru documentație"
            value={listingStatus}
            onChange={handleListingStatusChange}
            className="h-9 rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
          >
            <option value="">Toate documentele</option>
            <option value="rejected">Documentație respinsă</option>
            <option value="pending_approval">În aprobare</option>
          </select>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 select-none">
            <input
              type="checkbox"
              checked={relevantOnly}
              onChange={handleRelevantOnlyChange}
              className="h-[14px] w-[14px] accent-[var(--brand-500,#6366f1)]"
            />
            Produse relevante
          </label>
          <div className="flex-1" />
          {activeBatch ? (
            <ImportBatchIndicator batch={activeBatch} />
          ) : (
            <ImportSourceDropdown
              plugins={plugins}
              onImported={(): void => {
                router.refresh();
              }}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busyId === '__all__'}
            onClick={(): void => void handleDeleteAll()}
            style={{ color: 'var(--danger, #ef4444)', borderColor: 'rgba(239,68,68,0.3)' }}
          >
            Șterge toate
          </Button>
          <Button asChild size="sm">
            <Link href="/products/new">+ Produs nou</Link>
          </Button>
        </div>

        {deleteError !== null ? (
          <p role="alert" className="text-[13px] text-danger" data-testid="product-delete-error">
            {deleteError}
          </p>
        ) : null}

        {/* Card grid */}
        {rows.length === 0 ? (
          <div
            data-testid="products-empty"
            className="rounded-[18px] border border-dashed border-ink-300 bg-surface p-10 text-center text-[13px] text-ink-500"
          >
            Niciun produs găsit.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(max(220px, calc(20% - 14px)), 1fr))',
              alignItems: 'start',
              gap: 16,
              marginTop: 16,
            }}
          >
            {rows.map((row) => (
              <ProductCard
                key={row.id}
                row={row}
                open={openCardId === row.id}
                busy={busyId === row.id}
                onToggle={(open): void => setOpenCardId(open ? row.id : null)}
                onDelete={(): void => {
                  void handleDelete(row.id, row.sku);
                }}
                onRefresh={(): void => router.refresh()}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[12px] text-ink-500" data-testid="products-pagination-info">
            Pagina {page} din {totalPages} ({total} total)
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
    </>
  );
}
