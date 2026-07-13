'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useFieldArray, useForm, type UseFieldArrayReturn } from 'react-hook-form';
import { z } from 'zod';

import type { ReactElement } from 'react';

import { MPLogo, packageToLogoName } from '@/components/mp-logo';
import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';
import { marketplaceLabel } from '@/lib/marketplace-catalog';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ListingInfo {
  id: string;
  pluginId: string;
  pluginPackage: string;
  platform: string;
  status: string;
  syncState: Record<string, unknown>;
}

export interface ProductFormInitial {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: { amountMinor: string; currency: string };
  stockQuantity: number;
  images: { url: string; alt?: string }[];
  attributes: Record<string, unknown>;
  isActive: boolean;
  brand?: string | null;
  ean?: string | null;
  vatRate?: number | null;
  purchasePriceAmountMinor?: string | null;
  fullPriceAmountMinor?: string | null;
  weightGrams?: number | null;
  heightMm?: number | null;
  widthMm?: number | null;
  lengthMm?: number | null;
  warrantyMonths?: number | null;
  handlingTimeDays?: number | null;
  numberOfPackages?: number | null;
  listings?: ListingInfo[];
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  initial?: ProductFormInitial;
}

// ── Form schema ────────────────────────────────────────────────────────────────

const formSchema = z.object({
  sku: z.string().min(1, 'SKU obligatoriu').max(64),
  name: z.string().min(1, 'Numele e obligatoriu').max(255),
  description: z.string().optional(),
  priceAmount: z.coerce.number().min(0, 'Preț minim 0'),
  priceCurrency: z.string().length(3),
  stockQuantity: z.coerce.number().int().min(0, 'Stoc minim 0'),
  brand: z.string().optional(),
  ean: z.string().optional(),
  vatRate: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0).max(100).optional(),
  ),
  purchasePriceAmount: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? 0 : Number(v)),
    z.number().min(0).default(0),
  ),
  fullPriceAmount: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? 0 : Number(v)),
    z.number().min(0).default(0),
  ),
  weightGrams: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().nonnegative().optional(),
  ),
  heightMm: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().nonnegative().optional(),
  ),
  widthMm: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().nonnegative().optional(),
  ),
  lengthMm: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().nonnegative().optional(),
  ),
  warrantyMonths: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0).max(600).optional(),
  ),
  handlingTimeDays: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0).max(30).optional(),
  ),
  numberOfPackages: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(1).max(99).optional(),
  ),
  isActive: z.boolean(),
  images: z.array(z.object({ url: z.string(), alt: z.string().optional() })),
  attributes: z.array(z.object({ key: z.string().min(1), value: z.string() })),
});

export type ProductFormValues = z.infer<typeof formSchema>;

function buildDefaults(initial?: ProductFormInitial): ProductFormValues {
  if (!initial) {
    return {
      sku: '',
      name: '',
      description: '',
      priceAmount: 0,
      priceCurrency: 'RON',
      stockQuantity: 0,
      brand: '',
      ean: '',
      vatRate: undefined,
      purchasePriceAmount: 0,
      fullPriceAmount: 0,
      weightGrams: undefined,
      heightMm: undefined,
      widthMm: undefined,
      lengthMm: undefined,
      warrantyMonths: undefined,
      handlingTimeDays: undefined,
      numberOfPackages: undefined,
      isActive: true,
      images: [],
      attributes: [],
    };
  }
  // EAN: prefer dedicated column, fall back to legacy attributes for old records
  const attrs = initial.attributes;
  const ean =
    initial.ean ??
    (typeof attrs.EAN === 'string' ? attrs.EAN : typeof attrs.ean === 'string' ? attrs.ean : '');
  return {
    sku: initial.sku,
    name: initial.name,
    description: initial.description ?? '',
    priceAmount: Number(BigInt(initial.price.amountMinor)) / 100,
    priceCurrency: initial.price.currency,
    stockQuantity: initial.stockQuantity,
    brand: initial.brand ?? '',
    ean,
    vatRate: initial.vatRate ?? undefined,
    purchasePriceAmount: initial.purchasePriceAmountMinor
      ? Number(BigInt(initial.purchasePriceAmountMinor)) / 100
      : 0,
    fullPriceAmount: initial.fullPriceAmountMinor
      ? Number(BigInt(initial.fullPriceAmountMinor)) / 100
      : 0,
    weightGrams: initial.weightGrams ?? undefined,
    heightMm: initial.heightMm ?? undefined,
    widthMm: initial.widthMm ?? undefined,
    lengthMm: initial.lengthMm ?? undefined,
    warrantyMonths: initial.warrantyMonths ?? undefined,
    handlingTimeDays: initial.handlingTimeDays ?? undefined,
    numberOfPackages: initial.numberOfPackages ?? undefined,
    isActive: initial.isActive,
    images: initial.images.map((i) => ({ url: i.url, alt: i.alt ?? '' })),
    attributes: Object.entries(initial.attributes)
      .filter(([k]) => k !== 'EAN' && k !== 'ean')
      .map(([k, v]) => ({
        key: k,
        value: typeof v === 'string' ? v : JSON.stringify(v),
      })),
  };
}

// ── Primitives (matching design) ───────────────────────────────────────────────

const inputCls =
  'h-[38px] w-full rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 ' +
  'placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150';

const textareaCls =
  'w-full rounded-[10px] border border-ink-200 bg-surface px-3 py-2 text-[13.5px] text-ink-900 ' +
  'placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15 ' +
  'font-[inherit] resize-y';

function FieldLabel({
  children,
  optional,
}: {
  children: React.ReactNode;
  optional?: boolean;
}): ReactElement {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}
    >
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--ink-700, #374151)',
          letterSpacing: '0.01em',
        }}
      >
        {children}
      </span>
      {optional && (
        <span style={{ fontSize: 10.5, color: 'var(--ink-400, #9ca3af)', flexShrink: 0 }}>
          opțional
        </span>
      )}
    </div>
  );
}

function CardBlock({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <div className="rounded-[18px] border border-ink-200 bg-surface p-[18px] shadow-os-sm">
      {children}
    </div>
  );
}

// ── PhotoSlot ──────────────────────────────────────────────────────────────────

function PhotoSlot({
  url,
  primary,
  onRemove,
}: {
  url: string;
  primary: boolean;
  onRemove: () => void;
}): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        borderRadius: 10,
        overflow: 'hidden',
        border: primary
          ? '2px solid var(--brand-600, #2563eb)'
          : '1px solid var(--ink-200, #e5e7eb)',
        background: 'var(--ink-50, #f9fafb)',
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
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
            color: 'var(--ink-400, #9ca3af)',
          }}
        >
          IMG
        </div>
      )}
      {primary && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'var(--brand-600, #2563eb)',
            color: '#fff',
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Principală
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: 'rgba(11,13,18,0.7)',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
          fontSize: 13,
          lineHeight: 1,
        }}
        aria-label="Șterge imagine"
      >
        ×
      </button>
    </div>
  );
}

function DraggablePhotos({
  images,
  onRemove,
  onAdd,
  onReorder,
}: {
  images: { url: string }[];
  onRemove: (idx: number) => void;
  onAdd: () => void;
  onReorder: (from: number, to: number) => void;
}): ReactElement {
  const dragIdx = useRef<number | null>(null);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 10,
      }}
    >
      {images.map((ph, i) => (
        <div
          key={i}
          draggable
          onDragStart={(): void => {
            dragIdx.current = i;
          }}
          onDragOver={(e): void => {
            e.preventDefault();
            if (dragIdx.current === null || dragIdx.current === i) return;
            onReorder(dragIdx.current, i);
            dragIdx.current = i;
          }}
          onDragEnd={(): void => {
            dragIdx.current = null;
          }}
          style={{ cursor: 'grab', userSelect: 'none' }}
        >
          <PhotoSlot url={ph.url} primary={i === 0} onRemove={(): void => onRemove(i)} />
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        style={{
          aspectRatio: '1 / 1',
          border: '1.5px dashed var(--ink-300, #d1d5db)',
          borderRadius: 10,
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          color: 'var(--ink-500, #6b7280)',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span style={{ fontSize: 11.5, fontWeight: 500 }}>Adaugă imagine</span>
      </button>
    </div>
  );
}

// ── UnsavedModal ───────────────────────────────────────────────────────────────

function UnsavedModal({
  onSave,
  onDiscard,
  onCancel,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(11,13,18,0.5)',
          zIndex: 200,
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 420,
          background: 'var(--surface, #fff)',
          borderRadius: 16,
          border: '1px solid var(--ink-200, #e5e7eb)',
          padding: 28,
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(245,158,11,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--warning, #f59e0b)' }}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v6M12 17h.01" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
              Modificări nesalvate
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--ink-500, #6b7280)',
                marginTop: 5,
                lineHeight: 1.5,
              }}
            >
              Ai modificări care nu au fost salvate. Ce vrei să faci cu ele?
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Continuă editarea
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
            Renunță
          </Button>
          <Button type="button" size="sm" onClick={onSave}>
            Salvează modificările
          </Button>
        </div>
      </div>
    </>
  );
}

// ── PrincipalContent ───────────────────────────────────────────────────────────

interface PrincipalContentProps {
  form: ReturnType<typeof useForm<ProductFormValues>>;
  images: UseFieldArrayReturn<ProductFormValues, 'images', 'id'>;
  attributes: UseFieldArrayReturn<ProductFormValues, 'attributes', 'id'>;
  productId?: string | undefined;
}

function PrincipalContent({
  form,
  images,
  attributes,
  productId,
}: PrincipalContentProps): ReactElement {
  const {
    register,
    watch,
    formState: { errors },
  } = form;
  const [descPreview, setDescPreview] = useState(false);
  const descValue = watch('description');

  function handleReorder(from: number, to: number): void {
    const fields = images.fields as { url: string; alt?: string }[];
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    // re-build field array
    images.replace(next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Title */}
      <CardBlock>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--ink-900, #0b0d12)',
            marginBottom: 14,
          }}
        >
          Titlu produs
        </div>
        <input
          aria-label="Nume"
          className={inputCls}
          style={{ height: 42, fontSize: 15 }}
          placeholder="Ex: Apă de parfum Aventura Edition 50ml"
          {...register('name')}
        />
        {errors.name?.message ? (
          <p style={{ marginTop: 4, fontSize: 12, color: 'var(--danger, #ef4444)' }}>
            {errors.name.message}
          </p>
        ) : null}
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Folosit pe toate marketplace-urile, dacă nu setezi un titlu specific.
        </div>
      </CardBlock>

      {/* Photos */}
      <CardBlock>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
              Poze produs
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-500, #6b7280)', marginTop: 2 }}>
              Trage pozele pentru a le reordona. Prima poză devine principală.
            </div>
          </div>
        </div>
        {images.fields.length === 0 && (
          <p
            data-testid="images-empty"
            style={{ fontSize: 13, color: 'var(--ink-500, #6b7280)', marginBottom: 8 }}
          >
            Nicio poză adăugată.
          </p>
        )}
        <DraggablePhotos
          images={(images.fields as { url: string }[]).map((f) => ({ url: f.url }))}
          onRemove={(idx): void => images.remove(idx)}
          onAdd={(): void => images.append({ url: '', alt: '' })}
          onReorder={handleReorder}
        />
        {/* URL inputs for images */}
        {(images.fields as { id: string; url: string }[]).map((f, idx) => (
          <div key={f.id} style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <input
              aria-label={`URL imagine ${idx + 1}`}
              className={inputCls}
              placeholder="https://..."
              {...register(`images.${idx}.url`)}
            />
          </div>
        ))}
      </CardBlock>

      {/* Description */}
      <CardBlock>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
            Descriere
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={(): void => setDescPreview((p) => !p)}
              style={{
                padding: '0 10px',
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: descPreview ? 'var(--ink-100, #f3f4f6)' : 'transparent',
                cursor: 'pointer',
                fontSize: 11.5,
                fontWeight: 500,
                color: 'var(--ink-600, #4b5563)',
                whiteSpace: 'nowrap',
              }}
            >
              {descPreview ? 'Editare' : 'Preview HTML'}
            </button>
            <button
              type="button"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: 'transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
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
                <path d="M6 4h7a4 4 0 0 1 0 8H6Z" />
                <path d="M6 12h8a4 4 0 0 1 0 8H6Z" />
              </svg>
            </button>
            <button
              type="button"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: 'transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
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
                <path d="M19 4h-9M14 20H5M15 4 9 20" />
              </svg>
            </button>
            <button
              type="button"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: 'transparent',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
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
                <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />
              </svg>
            </button>
          </div>
        </div>
        {descPreview ? (
          <div
            dangerouslySetInnerHTML={{ __html: descValue ?? '' }}
            style={{
              minHeight: 140,
              padding: '8px 12px',
              border: '1px solid var(--ink-200, #e5e7eb)',
              borderRadius: 10,
              fontSize: 13.5,
              lineHeight: 1.7,
              color: 'var(--ink-900, #0b0d12)',
            }}
          />
        ) : (
          <textarea
            className={textareaCls}
            rows={6}
            style={{ minHeight: 140 }}
            {...register('description')}
          />
        )}
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Acceptă HTML simplu: paragrafe, liste, link-uri.
        </div>
      </CardBlock>

      {/* Attributes */}
      <CardBlock>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--ink-900, #0b0d12)',
            marginBottom: 14,
          }}
        >
          Caracteristici
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {attributes.fields.length === 0 && (
            <p
              data-testid="attributes-empty"
              style={{ fontSize: 13, color: 'var(--ink-500, #6b7280)' }}
            >
              Nicio caracteristică adăugată.
            </p>
          )}
          {(attributes.fields as { id: string; key: string; value: string }[]).map((f, idx) => (
            <div
              key={f.id}
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8 }}
            >
              <input
                aria-label={`Cheie atribut ${idx + 1}`}
                className={inputCls}
                style={{ height: 34 }}
                placeholder="Cheie"
                {...register(`attributes.${idx}.key`)}
              />
              <input
                aria-label={`Valoare atribut ${idx + 1}`}
                className={inputCls}
                style={{ height: 34 }}
                placeholder="Valoare"
                {...register(`attributes.${idx}.value`)}
              />
              <button
                type="button"
                onClick={(): void => attributes.remove(idx)}
                style={{
                  height: 34,
                  width: 32,
                  borderRadius: 8,
                  border: '1px solid var(--ink-200, #e5e7eb)',
                  background: 'transparent',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--ink-500, #6b7280)',
                }}
                aria-label={`Șterge atribut ${idx + 1}`}
              >
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
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(): void => attributes.append({ key: '', value: '' })}
          >
            + Adaugă atribut
          </Button>
        </div>
      </CardBlock>

      {/* Price */}
      <CardBlock>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-500, #6b7280)',
            marginBottom: 12,
          }}
        >
          Preț principal
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            aria-label="Preț"
            className={`${inputCls} font-mono`}
            type="number"
            step="0.01"
            style={{ fontSize: 18, fontWeight: 600, height: 44, letterSpacing: '-0.01em' }}
            {...register('priceAmount')}
          />
          <select
            className={inputCls}
            style={{ height: 44, width: 90 }}
            {...register('priceCurrency')}
          >
            <option value="RON">RON</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="TRY">TRY</option>
            <option value="BGN">BGN</option>
            <option value="HUF">HUF</option>
          </select>
        </div>
        {errors.priceAmount?.message ? (
          <p style={{ marginTop: 4, fontSize: 12, color: 'var(--danger, #ef4444)' }}>
            {errors.priceAmount.message}
          </p>
        ) : null}
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Folosit ca preț implicit pe toate canalele care nu au preț specific.
        </div>
        {/* Full price (crossed-out) */}
        <div style={{ marginTop: 12 }}>
          <FieldLabel optional>Preț întreg (barat)</FieldLabel>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              aria-label="Preț întreg"
              className={`${inputCls} font-mono`}
              type="number"
              step="0.01"
              style={{ flex: 1 }}
              {...register('fullPriceAmount')}
            />
            <span
              style={{
                height: 38,
                padding: '0 12px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 10,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: 'var(--ink-50, #f9fafb)',
                fontSize: 13,
                color: 'var(--ink-700, #374151)',
                fontWeight: 500,
              }}
            >
              {form.watch('priceCurrency')}
            </span>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
            Prețul original afișat tăiat lângă prețul de vânzare (0 = neafișat).
          </div>
        </div>
        {productId !== undefined && <SetAllOffersPrice productId={productId} />}
      </CardBlock>

      {/* Ambalaj & transport */}
      <CardBlock>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-500, #6b7280)',
            marginBottom: 14,
          }}
        >
          Ambalaj & transport
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel optional>Greutate (g)</FieldLabel>
            <input
              aria-label="Greutate grame"
              className={`${inputCls} font-mono`}
              type="number"
              step="1"
              min="0"
              placeholder="500"
              {...register('weightGrams')}
            />
          </div>
          <div>
            <FieldLabel optional>Nr. colete</FieldLabel>
            <input
              aria-label="Număr colete"
              className={`${inputCls} font-mono`}
              type="number"
              step="1"
              min="1"
              placeholder="1"
              {...register('numberOfPackages')}
            />
          </div>
          <div>
            <FieldLabel optional>Înălțime (mm)</FieldLabel>
            <input
              aria-label="Înălțime mm"
              className={`${inputCls} font-mono`}
              type="number"
              step="1"
              min="0"
              {...register('heightMm')}
            />
          </div>
          <div>
            <FieldLabel optional>Lățime (mm)</FieldLabel>
            <input
              aria-label="Lățime mm"
              className={`${inputCls} font-mono`}
              type="number"
              step="1"
              min="0"
              {...register('widthMm')}
            />
          </div>
          <div>
            <FieldLabel optional>Lungime (mm)</FieldLabel>
            <input
              aria-label="Lungime mm"
              className={`${inputCls} font-mono`}
              type="number"
              step="1"
              min="0"
              {...register('lengthMm')}
            />
          </div>
        </div>
      </CardBlock>
    </div>
  );
}

// ── SetAllOffersPrice ──────────────────────────────────────────────────────────

function SetAllOffersPrice({ productId }: { productId: string }): ReactElement {
  const [priceInput, setPriceInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);

  async function handleApply(): Promise<void> {
    const major = Number(priceInput);
    if (!Number.isFinite(major) || major < 0) {
      setStatus('error');
      setErrorMsg('Preț invalid.');
      return;
    }
    const amountMinor = Math.round(major * 100).toString();
    setStatus('saving');
    setErrorMsg(undefined);
    try {
      await getApiClient().post(`/products/${productId}/price`, { amountMinor });
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
      setErrorMsg('Eroare la aplicarea prețului.');
    }
  }

  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: '1px solid var(--ink-100, #f3f4f6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--ink-500, #6b7280)',
        }}
      >
        Setează preț pe toate ofertele
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          aria-label="Preț pentru toate ofertele"
          className={`${inputCls} font-mono`}
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={priceInput}
          onChange={(e): void => setPriceInput(e.target.value)}
          style={{ width: 130, height: 38 }}
        />
        <span
          style={{
            height: 38,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 10,
            border: '1px solid var(--ink-200, #e5e7eb)',
            background: 'var(--ink-50, #f9fafb)',
            fontSize: 13,
            color: 'var(--ink-700, #374151)',
            fontWeight: 500,
          }}
        >
          RON
        </span>
        <Button
          type="button"
          size="sm"
          disabled={status === 'saving'}
          onClick={(): void => {
            void handleApply();
          }}
        >
          {status === 'saving' ? 'Se aplică…' : 'Aplică pe toate'}
        </Button>
        {status === 'saved' && (
          <span style={{ fontSize: 12.5, color: 'var(--success, #22c55e)', fontWeight: 500 }}>
            Aplicat cu succes.
          </span>
        )}
        {status === 'error' && (
          <span style={{ fontSize: 12.5, color: 'var(--danger, #ef4444)', fontWeight: 500 }}>
            {errorMsg ?? 'Eroare.'}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
        Suprascrie prețul pe toate ofertele active din toate marketplace-urile.
      </div>
    </div>
  );
}

// ── SaveBar ────────────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ── RawDataPanel ───────────────────────────────────────────────────────────────

export function RawDataPanel({
  syncState,
}: {
  syncState: Record<string, unknown>;
}): ReactElement | null {
  const rawMarketplace = syncState.raw_marketplace;
  const rawImport = syncState.raw_import;
  const hasMarketplace = rawMarketplace !== undefined && rawMarketplace !== null;
  const hasImport = rawImport !== undefined && rawImport !== null;
  if (!hasMarketplace && !hasImport) return null;

  return (
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
        <div className="text-[13.5px] font-medium text-ink-700">Date brute ofertă</div>
        <span className="ml-auto text-[11px] text-ink-400">▸ expand</span>
      </summary>
      <div className="flex flex-col gap-4 p-4">
        {hasMarketplace && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              De la marketplace
            </div>
            <pre className="max-h-[400px] overflow-auto font-mono text-[11px] leading-relaxed text-ink-700">
              {JSON.stringify(rawMarketplace, null, 2)}
            </pre>
          </div>
        )}
        {hasImport && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Importat de utilizator
            </div>
            <pre className="max-h-[400px] overflow-auto font-mono text-[11px] leading-relaxed text-ink-700">
              {JSON.stringify(rawImport, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function SaveBar({
  status,
  onSave,
  errorMessage,
}: {
  status: SaveStatus;
  onSave: () => void;
  errorMessage: string | undefined;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        padding: '10px 0',
      }}
    >
      {status === 'saved' && (
        <span style={{ fontSize: 12.5, color: 'var(--success, #22c55e)', fontWeight: 500 }}>
          Salvat cu succes.
        </span>
      )}
      {status === 'error' && (
        <span style={{ fontSize: 12.5, color: 'var(--danger, #ef4444)', fontWeight: 500 }}>
          {errorMessage ?? 'Eroare la salvare.'}
        </span>
      )}
      <Button type="button" size="sm" onClick={onSave} disabled={status === 'saving'}>
        {status === 'saving' ? 'Se salvează…' : 'Salvează modificările'}
      </Button>
    </div>
  );
}

// ── TrendyolTabContent ──────────────────────────────────────────────────────────

function TrendyolTabContent({
  listingId,
  syncState,
}: {
  listingId: string;
  syncState: Record<string, unknown>;
}): ReactElement {
  const initialTitle = typeof syncState.title === 'string' ? syncState.title : '';
  const initialDescription = typeof syncState.description === 'string' ? syncState.description : '';
  const brand = typeof syncState.brand === 'string' ? syncState.brand : '';
  const category = typeof syncState.category === 'string' ? syncState.category : '';
  const barcode = typeof syncState.barcode === 'string' ? syncState.barcode : null;
  const priceMinor =
    typeof syncState.price_amount_minor === 'string' ? syncState.price_amount_minor : '0';
  const currency = typeof syncState.price_currency === 'string' ? syncState.price_currency : 'TRY';
  const images = Array.isArray(syncState.images)
    ? (syncState.images as { url: string }[]).filter((i) => typeof i.url === 'string')
    : [];
  const attributes = Array.isArray(syncState.attributes)
    ? (
        syncState.attributes as {
          attributeName?: string;
          attributeValue?: string;
        }[]
      ).filter((a) => a.attributeName && a.attributeValue)
    : [];

  const initialPriceAmount = (Number(priceMinor) / 100).toFixed(2);

  // Controlled state
  const initialStockQuantity =
    typeof syncState.stock_quantity === 'number' ? syncState.stock_quantity : '';

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [priceAmount, setPriceAmount] = useState(initialPriceAmount);
  const [stockQuantity, setStockQuantity] = useState<number | ''>(initialStockQuantity);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [repushStatus, setRepushStatus] = useState<SaveStatus>('idle');

  // Approval status (from Trendyol /products/unapproved): show why a product
  // is not live so the user knows what to fix.
  const approved = syncState.approved;
  const rejectReasons = Array.isArray(syncState.reject_reasons)
    ? (syncState.reject_reasons as unknown[]).map((r) =>
        typeof r === 'string' ? r : JSON.stringify(r),
      )
    : [];
  const isUnapproved = approved === false || rejectReasons.length > 0;
  // Push status (rezultatul publicării pe Trendyol). `push_failure_reasons` vine
  // din `failureReasons` ale batch-ului; afișăm motivul + buton de retrimitere.
  const pushState = typeof syncState.push_state === 'string' ? syncState.push_state : undefined;
  const pushFailureReasons = Array.isArray(syncState.push_failure_reasons)
    ? (syncState.push_failure_reasons as unknown[]).map((r) =>
        typeof r === 'string' ? r : JSON.stringify(r),
      )
    : [];
  const canRepush = pushState === 'error' || pushState === 'rejected';
  // Easy Cross Country: non-RO storefronts mirror RO and are not editable here.
  const readOnly = syncState.read_only === true;

  async function handleSave(): Promise<void> {
    setSaveStatus('saving');
    setSaveError(undefined);
    try {
      const priceMinorValue = Math.round(Number(priceAmount) * 100).toString();
      const body: Record<string, unknown> = {
        title,
        description,
        price_amount_minor: priceMinorValue,
        price_currency: currency,
      };
      if (stockQuantity !== '') {
        body.stock_quantity = Number(stockQuantity);
      }
      await getApiClient().patch(`/listings/${listingId}/sync-state`, body);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setSaveError('Eroare la salvare. Încearcă din nou.');
    }
  }

  async function handleRepush(): Promise<void> {
    setRepushStatus('saving');
    try {
      await getApiClient().post(`/listings/${listingId}/repush`);
      setRepushStatus('saved');
      setTimeout(() => setRepushStatus('idle'), 3000);
    } catch {
      setRepushStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Sincronizat din RO (read-only) */}
      {readOnly && (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid rgba(59,91,255,0.3)',
            background: 'rgba(59,91,255,0.08)',
            padding: '12px 14px',
            fontSize: 12.5,
            color: 'var(--ink-700, #374151)',
          }}
        >
          <strong style={{ color: 'var(--brand-700, #2937cc)' }}>Sincronizat din RO.</strong>{' '}
          Această ofertă este gestionată prin „Easy Cross Country" și se actualizează automat din
          țara de origine (RO). Editează datele pe tab-ul Trendyol RO.
        </div>
      )}

      {/* Status aprobare */}
      {isUnapproved && (
        <div
          style={{
            borderRadius: 12,
            border: `1px solid ${rejectReasons.length > 0 ? 'rgba(239,68,68,0.35)' : 'rgba(234,179,8,0.4)'}`,
            background: rejectReasons.length > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.1)',
            padding: '12px 14px',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color:
                rejectReasons.length > 0 ? 'var(--danger, #ef4444)' : 'var(--warning, #b45309)',
            }}
          >
            {rejectReasons.length > 0 ? 'Respins pe Trendyol' : 'Neaprobat — în verificare'}
          </div>
          {rejectReasons.length > 0 ? (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {rejectReasons.map((r, i) => (
                <li
                  key={i}
                  style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 2 }}
                >
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--ink-600, #4b5563)', marginTop: 4 }}>
              Produsul a fost trimis spre aprobare și încă nu este publicat pe Trendyol.
            </div>
          )}
        </div>
      )}

      {/* Eroare la publicare (failureReasons din batch) */}
      {pushFailureReasons.length > 0 && (
        <div
          style={{
            borderRadius: 12,
            border: '1px solid rgba(239,68,68,0.35)',
            background: 'rgba(239,68,68,0.08)',
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger, #ef4444)' }}>
            Eroare la publicare pe Trendyol
          </div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {pushFailureReasons.map((r, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 2 }}>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Retrimitere manuală pe Trendyol (oferte în eroare / respinse) */}
      {canRepush && !readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => void handleRepush()}
            disabled={repushStatus === 'saving'}
            style={{
              borderRadius: 10,
              border: '1px solid var(--brand-600, #3b5bff)',
              background: 'var(--brand-600, #3b5bff)',
              color: '#fff',
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: repushStatus === 'saving' ? 'default' : 'pointer',
              opacity: repushStatus === 'saving' ? 0.7 : 1,
            }}
          >
            {repushStatus === 'saving'
              ? 'Se retrimite…'
              : repushStatus === 'saved'
                ? 'Retrimis ✓'
                : 'Retrimite pe Trendyol'}
          </button>
          {repushStatus === 'error' && (
            <span style={{ fontSize: 12, color: 'var(--danger, #ef4444)' }}>
              Eroare la retrimitere. Încearcă din nou.
            </span>
          )}
        </div>
      )}

      {/* Titlu */}
      <CardBlock>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--ink-900, #0b0d12)',
            marginBottom: 14,
          }}
        >
          Titlu pe Trendyol
        </div>
        <input
          className={inputCls}
          style={{ height: 42, fontSize: 15 }}
          value={title}
          onChange={(e): void => setTitle(e.target.value)}
          disabled={readOnly}
          placeholder="Titlu specific pentru Trendyol..."
        />
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Lasă gol pentru a folosi titlul principal.
        </div>
      </CardBlock>

      {/* Brand & Categorie */}
      <CardBlock>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-500, #6b7280)',
            marginBottom: 12,
          }}
        >
          Brand & Categorie
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel optional>Brand</FieldLabel>
            <input
              className={inputCls}
              defaultValue={brand}
              disabled={readOnly}
              placeholder="Ex: Nike"
            />
          </div>
          <div>
            <FieldLabel optional>Categorie</FieldLabel>
            <input
              className={inputCls}
              defaultValue={category}
              disabled={readOnly}
              placeholder="Ex: Încălțăminte"
            />
          </div>
        </div>
      </CardBlock>

      {/* EAN / Barcode */}
      {barcode && (
        <CardBlock>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--ink-500, #6b7280)',
              marginBottom: 12,
            }}
          >
            Identificare & stoc
          </div>
          <div>
            <FieldLabel>EAN / Cod de bare</FieldLabel>
            <input
              className={`${inputCls} font-mono`}
              value={barcode}
              disabled
              readOnly
              placeholder="—"
            />
          </div>
        </CardBlock>
      )}

      {/* Poze */}
      {images.length > 0 && (
        <CardBlock>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-900, #0b0d12)',
              marginBottom: 10,
            }}
          >
            Poze produs ({images.length})
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {images.map((img, i) => (
              <img
                key={i}
                src={img.url}
                alt={`Trendyol ${i + 1}`}
                style={{
                  width: 80,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 8,
                  border: '1px solid var(--ink-200, #e5e7eb)',
                }}
              />
            ))}
          </div>
        </CardBlock>
      )}

      {/* Descriere */}
      <CardBlock>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
            Descriere pe Trendyol
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['B', 'I', '≡'].map((label) => (
              <button
                key={label}
                type="button"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--ink-200, #e5e7eb)',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          className={textareaCls}
          rows={5}
          style={{ minHeight: 120 }}
          value={description}
          onChange={(e): void => setDescription(e.target.value)}
          disabled={readOnly}
          placeholder="Lasă gol pentru a folosi descrierea principală pe Trendyol."
        />
      </CardBlock>

      {/* Caracteristici */}
      {attributes.length > 0 && (
        <CardBlock>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-900, #0b0d12)',
              marginBottom: 10,
            }}
          >
            Caracteristici ({attributes.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
            {attributes.map((a, i) => (
              <>
                <span key={`k-${i}`} style={{ fontSize: 12.5, color: 'var(--ink-500, #6b7280)' }}>
                  {a.attributeName}
                </span>
                <span
                  key={`v-${i}`}
                  style={{ fontSize: 12.5, color: 'var(--ink-900, #0b0d12)', fontWeight: 500 }}
                >
                  {a.attributeValue}
                </span>
              </>
            ))}
          </div>
        </CardBlock>
      )}

      {/* Preț Trendyol */}
      <CardBlock>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-500, #6b7280)',
            marginBottom: 12,
          }}
        >
          Preț pe Trendyol
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className={`${inputCls} font-mono`}
            type="number"
            step="0.01"
            value={priceAmount}
            onChange={(e): void => setPriceAmount(e.target.value)}
            disabled={readOnly}
            style={{ fontSize: 18, fontWeight: 600, height: 44, letterSpacing: '-0.01em' }}
          />
          <span
            style={{
              height: 44,
              padding: '0 14px',
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 10,
              border: '1px solid var(--ink-200, #e5e7eb)',
              background: 'var(--ink-50, #f9fafb)',
              fontSize: 13,
              color: 'var(--ink-700, #374151)',
              fontWeight: 500,
            }}
          >
            {currency}
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Preț specific pentru Trendyol. Suprascrie prețul principal.
        </div>
      </CardBlock>

      {/* Stoc Trendyol */}
      <CardBlock>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-500, #6b7280)',
            marginBottom: 12,
          }}
        >
          Stoc pe Trendyol
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            aria-label="Stoc pe Trendyol"
            className={`${inputCls} font-mono`}
            type="number"
            step="1"
            min="0"
            value={stockQuantity === '' ? '' : stockQuantity}
            onChange={(e): void =>
              setStockQuantity(e.target.value === '' ? '' : Number(e.target.value))
            }
            disabled={readOnly}
            style={{ fontSize: 18, fontWeight: 600, height: 44, letterSpacing: '-0.01em' }}
          />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Stoc specific pentru Trendyol. Lasă gol pentru a nu trimite stocul.
        </div>
      </CardBlock>

      {!readOnly && (
        <SaveBar
          status={saveStatus}
          onSave={(): void => {
            void handleSave();
          }}
          errorMessage={saveError}
        />
      )}

      <RawDataPanel syncState={syncState} />
    </div>
  );
}

// ── OfferStatusBanner ───────────────────────────────────────────────────────────
// Status + mesaj de eroare per-ofertă + buton de (re)push. Generic pentru orice
// marketplace (eMAG / Temu / Trendyol): citește `listing.status` și mesajele de
// eroare din `syncState.last_error.message` (eMAG/Temu) sau
// `push_failure_reasons` / `reject_reasons` (Trendyol). Butonul „Trimite" apelează
// `POST /listings/:id/repush`, care re-enqueue-uiește push-ul (la eMAG →
// product_offer/save) indiferent de starea de enablement a marketplace-ului.

function offerStatusBadge(status: string): { label: string; fg: string; bg: string } {
  switch (status) {
    case 'active':
      return { label: 'Activ', fg: 'var(--success, #16a34a)', bg: 'rgba(22,163,74,0.1)' };
    case 'error':
      return {
        label: 'Eroare la publicare',
        fg: 'var(--danger, #ef4444)',
        bg: 'rgba(239,68,68,0.1)',
      };
    case 'rejected':
      return { label: 'Respins', fg: 'var(--danger, #ef4444)', bg: 'rgba(239,68,68,0.1)' };
    case 'pending_approval':
      return { label: 'În aprobare', fg: 'var(--warning, #b45309)', bg: 'rgba(234,179,8,0.12)' };
    case 'paused':
      return { label: 'Pe pauză', fg: 'var(--ink-600, #4b5563)', bg: 'rgba(107,114,128,0.12)' };
    case 'draft':
      return { label: 'Nepublicat', fg: 'var(--ink-600, #4b5563)', bg: 'rgba(107,114,128,0.12)' };
    default:
      return { label: status || '—', fg: 'var(--ink-600, #4b5563)', bg: 'rgba(107,114,128,0.12)' };
  }
}

function readErrorMessage(v: unknown): string | undefined {
  if (v !== null && typeof v === 'object' && 'message' in v) {
    const m = (v as Record<string, unknown>).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return undefined;
}

function readReasonList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))) : [];
}

interface EmagErrorItem {
  message: string;
  extraInfo?: string;
}

interface EmagErrorsBreakdown {
  errors: EmagErrorItem[];
  warnings: EmagErrorItem[];
  info: EmagErrorItem[];
}

function toEmagErrorItems(arr: unknown[]): EmagErrorItem[] {
  return arr.flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const o = e as Record<string, unknown>;
    if (o.section === 'disclaimer') return [];
    const msgObj = o.message;
    let msg: string | undefined;
    if (msgObj && typeof msgObj === 'object' && !Array.isArray(msgObj)) {
      const m = msgObj as Record<string, unknown>;
      msg =
        typeof m.ro_RO === 'string' ? m.ro_RO : typeof m.en_GB === 'string' ? m.en_GB : undefined;
    }
    if (!msg) return [];
    const item: EmagErrorItem = { message: msg };
    if (typeof o.extraInfo === 'string' && o.extraInfo) item.extraInfo = o.extraInfo;
    return [item];
  });
}

function extractEmagValidationErrorsBreakdown(
  syncState: Record<string, unknown>,
): EmagErrorsBreakdown | null {
  const rawVs = syncState.validation_status;
  const obj = Array.isArray(rawVs) ? (rawVs as unknown[])[0] : rawVs;
  if (!obj || typeof obj !== 'object') return null;
  const errorsRaw = (obj as Record<string, unknown>).errors;
  if (!errorsRaw || typeof errorsRaw !== 'object' || Array.isArray(errorsRaw)) return null;
  const e = errorsRaw as Record<string, unknown>;
  const breakdown: EmagErrorsBreakdown = {
    errors: toEmagErrorItems(Array.isArray(e.errors) ? e.errors : []),
    warnings: toEmagErrorItems(Array.isArray(e.warnings) ? e.warnings : []),
    info: toEmagErrorItems(Array.isArray(e.info) ? e.info : []),
  };
  const hasAny =
    breakdown.errors.length > 0 || breakdown.warnings.length > 0 || breakdown.info.length > 0;
  return hasAny ? breakdown : null;
}

// eMAG returnează validation_status ca array [{value, description}] sau obiect {value, description}.
function extractEmagValidationEntry(raw: unknown): { value: number; description?: string } | null {
  if (!raw) return null;
  const obj = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const value = typeof o.value === 'number' ? o.value : Number(o.value);
  if (!Number.isFinite(value)) return null;
  const desc =
    typeof o.description === 'string'
      ? o.description
      : typeof o.Description === 'string'
        ? o.Description
        : undefined;
  return desc !== undefined ? { value, description: desc } : { value };
}

function emagValidationBadge(value: number): { fg: string; bg: string } {
  if ([9, 11, 12, 3].includes(value))
    return { fg: 'var(--success, #16a34a)', bg: 'rgba(22,163,74,0.10)' };
  if ([5, 6, 8].includes(value))
    return { fg: 'var(--danger, #ef4444)', bg: 'rgba(239,68,68,0.10)' };
  if ([1, 2, 4].includes(value))
    return { fg: 'var(--warning, #b45309)', bg: 'rgba(234,179,8,0.12)' };
  if (value === 10) return { fg: 'var(--ink-600, #4b5563)', bg: 'rgba(107,114,128,0.12)' };
  return { fg: 'var(--ink-600, #4b5563)', bg: 'rgba(107,114,128,0.12)' };
}

interface PushTraceResult {
  conclusion?: string;
  error?: string | null;
  apiInvoked?: boolean;
  family?: string | null;
  steps?: { step: string; ok: boolean; detail: string }[];
}

interface ResyncOfferResult {
  ok: boolean;
  message: string;
  changes?: { field: string; before: unknown; after: unknown }[];
}

function formatChangeValue(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

export function OfferStatusBanner({
  listingId,
  channelId,
  mpName,
  status,
  syncState,
}: {
  listingId: string;
  channelId: string;
  mpName: string;
  status: string;
  syncState: Record<string, unknown>;
}): ReactElement {
  const router = useRouter();
  const [repushStatus, setRepushStatus] = useState<SaveStatus>('idle');
  const [tracing, setTracing] = useState(false);
  const [trace, setTrace] = useState<PushTraceResult | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<ResyncOfferResult | null>(null);
  const readOnly = syncState.read_only === true;
  const badge = offerStatusBadge(status);
  const lastErrorMsg = readErrorMessage(syncState.last_error);
  const failureReasons = readReasonList(syncState.push_failure_reasons);
  const rejectReasons = readReasonList(syncState.reject_reasons);
  const hasError =
    lastErrorMsg !== undefined || failureReasons.length > 0 || rejectReasons.length > 0;
  const isEmag = channelId.startsWith('emag-') || channelId.startsWith('fd-');

  async function handleRepush(): Promise<void> {
    setRepushStatus('saving');
    try {
      await getApiClient().post(`/listings/${listingId}/repush`);
      setRepushStatus('saved');
      setTimeout(() => setRepushStatus('idle'), 3000);
    } catch {
      setRepushStatus('error');
    }
  }

  // Testează SINCRON push-ul pe marketplace (ocolind coada de job-uri) și arată
  // trace-ul pas-cu-pas + eroarea brută — ca să vedem exact de ce nu se publică.
  async function handleDiagnostic(): Promise<void> {
    setTracing(true);
    setTrace(null);
    try {
      const res = await getApiClient().post<PushTraceResult>(`/debug/push-offer/${listingId}`);
      setTrace(res);
    } catch (e) {
      setTrace({
        conclusion: 'Eroare la rularea diagnosticului (endpoint indisponibil sau fără permisiune).',
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTracing(false);
    }
  }

  // Citește starea LIVE a ofertei de pe eMAG (titlu/poze/preț/stoc/status) și o
  // trage înapoi ca override per-ofertă — pentru modificări făcute manual direct
  // în interfața eMAG (ex. dezactivat oferta, schimbat prețul) care altfel nu ar
  // ajunge niciodată în OpenSales. router.refresh() readuce syncState-ul proaspăt de
  // pe server; MarketplaceContent e remontat (key legat de last_manual_resync_at) ca
  // să nu rămână cu titlul/prețul/stocul vechi în state local — altfel un „Salvează"
  // ulterior ar suprascrie exact valorile pe care resync-ul tocmai le-a adus.
  async function handleResync(): Promise<void> {
    setResyncing(true);
    setResyncResult(null);
    try {
      const res = await getApiClient().post<ResyncOfferResult>(`/debug/resync-offer/${listingId}`);
      setResyncResult(res);
      if (res.ok) router.refresh();
    } catch (e) {
      setResyncResult({
        ok: false,
        message: e instanceof Error ? e.message : 'Eroare la resincronizare.',
      });
    } finally {
      setResyncing(false);
    }
  }

  return (
    <div
      data-testid="offer-status-banner"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderRadius: 12,
        border: '1px solid var(--ink-200, #e5e7eb)',
        background: 'var(--surface, #fff)',
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--ink-500, #6b7280)' }}>
          Status pe {mpName}:
        </span>
        <span
          data-testid="offer-status-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 12,
            fontWeight: 600,
            color: badge.fg,
            background: badge.bg,
          }}
        >
          {badge.label}
        </span>
        {(() => {
          // Fallback: daca validation_status nu e setat direct, incercam raw_marketplace
          const rawMp =
            syncState.raw_marketplace !== null && typeof syncState.raw_marketplace === 'object'
              ? (syncState.raw_marketplace as Record<string, unknown>)
              : null;
          const vs =
            extractEmagValidationEntry(syncState.validation_status) ??
            extractEmagValidationEntry(rawMp?.validation_status);
          if (!vs) return null;
          const vsBadge = emagValidationBadge(vs.value);
          return (
            <span
              data-testid="emag-validation-description"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 999,
                padding: '2px 10px',
                fontSize: 12,
                fontWeight: 600,
                color: vsBadge.fg,
                background: vsBadge.bg,
              }}
            >
              {vs.description ?? `eMAG ${vs.value}`}
            </span>
          );
        })()}
        {(() => {
          const rawMp =
            syncState.raw_marketplace !== null && typeof syncState.raw_marketplace === 'object'
              ? (syncState.raw_marketplace as Record<string, unknown>)
              : null;
          const ovs =
            extractEmagValidationEntry(syncState.offer_validation_status) ??
            extractEmagValidationEntry(rawMp?.offer_validation_status);
          if (ovs?.value !== 2) return null;
          return (
            <span
              data-testid="emag-price-invalid-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 999,
                padding: '2px 10px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--warning, #b45309)',
                background: 'rgba(251,146,60,0.12)',
              }}
            >
              Pret invalid
            </span>
          );
        })()}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="offer-diagnostic-btn"
          onClick={() => void handleDiagnostic()}
          disabled={tracing}
          title="Testează sincron push-ul către marketplace și arată ce se întâmplă"
          style={{
            borderRadius: 10,
            border: '1px solid var(--ink-300, #d1d5db)',
            background: 'var(--surface, #fff)',
            color: 'var(--ink-700, #374151)',
            padding: '7px 13px',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: tracing ? 'default' : 'pointer',
            opacity: tracing ? 0.7 : 1,
          }}
        >
          {tracing ? 'Diagnostic…' : 'Diagnostic push'}
        </button>
        {isEmag && (
          <button
            type="button"
            data-testid="offer-resync-btn"
            onClick={() => void handleResync()}
            disabled={resyncing}
            title="Citește starea curentă de pe eMAG (titlu/poze/preț/stoc/status) și o aplică aici — pentru modificări făcute manual direct în interfața eMAG"
            style={{
              borderRadius: 10,
              border: '1px solid var(--ink-300, #d1d5db)',
              background: 'var(--surface, #fff)',
              color: 'var(--ink-700, #374151)',
              padding: '7px 13px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: resyncing ? 'default' : 'pointer',
              opacity: resyncing ? 0.7 : 1,
            }}
          >
            {resyncing ? 'Resincronizez…' : 'Resincronizează ofertă'}
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            data-testid="offer-repush-btn"
            onClick={() => void handleRepush()}
            disabled={repushStatus === 'saving'}
            style={{
              borderRadius: 10,
              border: '1px solid var(--brand-600, #3b5bff)',
              background: 'var(--brand-600, #3b5bff)',
              color: '#fff',
              padding: '7px 13px',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: repushStatus === 'saving' ? 'default' : 'pointer',
              opacity: repushStatus === 'saving' ? 0.7 : 1,
            }}
          >
            {repushStatus === 'saving'
              ? 'Se trimite…'
              : repushStatus === 'saved'
                ? 'Trimis ✓'
                : status === 'active'
                  ? `Retrimite pe ${mpName}`
                  : `Trimite pe ${mpName}`}
          </button>
        )}
      </div>

      {readOnly && (
        <div style={{ fontSize: 12, color: 'var(--ink-500, #6b7280)' }}>
          Ofertă sincronizată din RO (Easy Cross Country) — gestionată automat.
        </div>
      )}

      {repushStatus === 'error' && (
        <span style={{ fontSize: 12, color: 'var(--danger, #ef4444)' }}>
          Eroare la trimitere. Încearcă din nou.
        </span>
      )}

      {hasError && (
        <div
          data-testid="offer-error"
          style={{
            borderRadius: 10,
            border: '1px solid rgba(239,68,68,0.3)',
            background: 'rgba(239,68,68,0.07)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--danger, #ef4444)' }}>
            Mesaj de eroare la publicare pe {mpName}
          </div>
          {lastErrorMsg !== undefined && (
            <div style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 4 }}>
              {lastErrorMsg}
            </div>
          )}
          {(failureReasons.length > 0 || rejectReasons.length > 0) && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {[...failureReasons, ...rejectReasons].map((r, i) => (
                <li
                  key={i}
                  style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 2 }}
                >
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(() => {
        const breakdown = extractEmagValidationErrorsBreakdown(syncState);
        if (!breakdown) return null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {breakdown.errors.length > 0 && (
              <div
                style={{
                  borderRadius: 8,
                  border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(239,68,68,0.07)',
                  padding: '8px 12px',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--danger, #ef4444)',
                    marginBottom: 4,
                  }}
                >
                  Erori documentație eMAG
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {breakdown.errors.map((e, i) => (
                    <li
                      key={i}
                      style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 2 }}
                    >
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {breakdown.warnings.length > 0 && (
              <div
                style={{
                  borderRadius: 8,
                  border: '1px solid rgba(234,179,8,0.3)',
                  background: 'rgba(234,179,8,0.07)',
                  padding: '8px 12px',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--warning, #b45309)',
                    marginBottom: 4,
                  }}
                >
                  Avertismente documentație eMAG
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {breakdown.warnings.map((w, i) => (
                    <li
                      key={i}
                      style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 2 }}
                    >
                      {w.message}
                      {w.extraInfo && (
                        <span style={{ color: 'var(--ink-500, #6b7280)' }}> ({w.extraInfo})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {breakdown.info.length > 0 && (
              <div
                style={{
                  borderRadius: 8,
                  border: '1px solid rgba(59,91,255,0.2)',
                  background: 'rgba(59,91,255,0.05)',
                  padding: '8px 12px',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--brand-600, #3b5bff)',
                    marginBottom: 4,
                  }}
                >
                  Informații documentație eMAG
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {breakdown.info.map((inf, i) => (
                    <li
                      key={i}
                      style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 2 }}
                    >
                      {inf.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      {trace !== null && (
        <div
          data-testid="offer-diagnostic-result"
          style={{
            borderRadius: 10,
            border: '1px solid var(--ink-200, #e5e7eb)',
            background: 'var(--ink-50, #f9fafb)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
            Diagnostic push {trace.apiInvoked ? '(apel API efectuat)' : ''}
          </div>
          {trace.conclusion !== undefined && (
            <div style={{ fontSize: 12, color: 'var(--ink-700, #374151)', marginTop: 4 }}>
              {trace.conclusion}
            </div>
          )}
          {trace.steps !== undefined && trace.steps.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, listStyle: 'none' }}>
              {trace.steps.map((s, i) => (
                <li
                  key={i}
                  style={{ fontSize: 11.5, color: 'var(--ink-600, #4b5563)', marginTop: 2 }}
                >
                  <span
                    style={{ color: s.ok ? 'var(--success, #16a34a)' : 'var(--danger, #ef4444)' }}
                  >
                    {s.ok ? '✓' : '✗'}
                  </span>{' '}
                  {s.step}
                  {s.detail ? ` — ${s.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
          {trace.error !== undefined && trace.error !== null && (
            <pre
              style={{
                margin: '8px 0 0',
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(239,68,68,0.07)',
                color: 'var(--ink-700, #374151)',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 220,
                overflow: 'auto',
              }}
            >
              {trace.error}
            </pre>
          )}
        </div>
      )}

      {resyncResult !== null && (
        <div
          data-testid="offer-resync-result"
          style={{
            borderRadius: 10,
            border: `1px solid ${resyncResult.ok ? 'var(--ink-200, #e5e7eb)' : 'rgba(239,68,68,0.3)'}`,
            background: resyncResult.ok ? 'var(--ink-50, #f9fafb)' : 'rgba(239,68,68,0.07)',
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
            {resyncResult.message}
          </div>
          {resyncResult.changes !== undefined && resyncResult.changes.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
              {resyncResult.changes.map((c, i) => (
                <li
                  key={i}
                  style={{ fontSize: 11.5, color: 'var(--ink-600, #4b5563)', marginTop: 2 }}
                >
                  <strong>{c.field}</strong>: {formatChangeValue(c.before)} →{' '}
                  {formatChangeValue(c.after)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── MarketplaceContent ─────────────────────────────────────────────────────────

function MarketplaceContent({
  listingId,
  channelId,
  logo,
  mpName,
  status,
  productName,
  productPrice,
  currency,
  syncState,
}: {
  listingId: string;
  channelId: string;
  logo: string;
  mpName: string;
  status: string;
  productName: string;
  productPrice: number;
  currency: string;
  syncState: Record<string, unknown>;
}): ReactElement {
  if (channelId.startsWith('trendyol')) {
    // Trendyol are deja propriul UI de status/aprobare/erori + repush în
    // TrendyolTabContent; nu dublăm cu OfferStatusBanner.
    return <TrendyolTabContent listingId={listingId} syncState={syncState} />;
  }

  const mpImages = Array.isArray(syncState.images)
    ? (syncState.images as { url: string }[]).filter((i) => typeof i.url === 'string')
    : [];
  const mpCharacteristics = Array.isArray(syncState.characteristics)
    ? (syncState.characteristics as Record<string, unknown>[])
    : [];
  const initialDescription = typeof syncState.description === 'string' ? syncState.description : '';
  // Per-listing title/price/currency from syncState; fall back to the principal
  // product values so manual products (no syncState) still render sensibly.
  const initialTitle =
    typeof syncState.title === 'string' && syncState.title.length > 0
      ? syncState.title
      : productName;
  const mpPriceMinor =
    typeof syncState.price_amount_minor === 'string' ? Number(syncState.price_amount_minor) : NaN;
  const initialPrice = Number.isFinite(mpPriceMinor) ? mpPriceMinor / 100 : productPrice;
  const mpCurrency =
    typeof syncState.price_currency === 'string' && syncState.price_currency.length > 0
      ? syncState.price_currency
      : currency;

  // Date specifice Temu (variații + cost template), stocate exact cum au fost importate.
  const temu =
    syncState.temu && typeof syncState.temu === 'object'
      ? (syncState.temu as Record<string, unknown>)
      : undefined;
  const temuVariations =
    temu && Array.isArray(temu.specDetails) ? (temu.specDetails as Record<string, unknown>[]) : [];
  const initialTemuCostTemplateId = ((): string => {
    if (
      !temu ||
      typeof temu.goodsServicePromise !== 'object' ||
      temu.goodsServicePromise === null
    ) {
      return '';
    }
    const gsp = temu.goodsServicePromise as Record<string, unknown>;
    return typeof gsp.costTemplateId === 'string' ? gsp.costTemplateId : '';
  })();

  const initialMpStockQuantity =
    typeof syncState.stock_quantity === 'number' ? syncState.stock_quantity : '';

  // Controlled state
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [priceAmount, setPriceAmount] = useState(initialPrice.toFixed(2));
  const [stockQuantity, setStockQuantity] = useState<number | ''>(initialMpStockQuantity);
  const [temuCostTemplateId, setTemuCostTemplateId] = useState(initialTemuCostTemplateId);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  async function handleSave(): Promise<void> {
    setSaveStatus('saving');
    setSaveError(undefined);
    try {
      const priceMinorValue = Math.round(Number(priceAmount) * 100).toString();
      const body: Record<string, unknown> = {
        title,
        description,
        price_amount_minor: priceMinorValue,
        price_currency: mpCurrency,
      };
      if (stockQuantity !== '') {
        body.stock_quantity = Number(stockQuantity);
      }
      if (temu !== undefined) {
        body.temu = {
          goodsServicePromise: { costTemplateId: temuCostTemplateId },
        };
      }
      await getApiClient().patch(`/listings/${listingId}/sync-state`, body);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setSaveError('Eroare la salvare. Încearcă din nou.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Status + eroare + (re)push per ofertă */}
      <OfferStatusBanner
        listingId={listingId}
        channelId={channelId}
        mpName={mpName}
        status={status}
        syncState={syncState}
      />

      {/* Titlu */}
      <CardBlock>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--ink-900, #0b0d12)',
            marginBottom: 14,
          }}
        >
          Titlu pe {mpName}
        </div>
        <input
          className={inputCls}
          style={{ height: 42, fontSize: 15 }}
          value={title}
          onChange={(e): void => setTitle(e.target.value)}
          placeholder={`Titlu specific pentru ${mpName}...`}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Lasă gol pentru a folosi titlul principal.
        </div>
      </CardBlock>

      {/* Poze din sincronizare */}
      {mpImages.length > 0 && (
        <CardBlock>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-900, #0b0d12)',
              marginBottom: 10,
            }}
          >
            Poze produs ({mpImages.length})
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {mpImages.map((img, i) => (
              <img
                key={i}
                src={img.url}
                alt={`${mpName} ${i + 1}`}
                style={{
                  width: 80,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 8,
                  border: '1px solid var(--ink-200, #e5e7eb)',
                }}
              />
            ))}
          </div>
        </CardBlock>
      )}

      {/* Descriere */}
      <CardBlock>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
            Descriere pe {mpName}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['B', 'I', '≡'].map((label) => (
              <button
                key={label}
                type="button"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: '1px solid var(--ink-200, #e5e7eb)',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          className={textareaCls}
          rows={5}
          style={{ minHeight: 120 }}
          value={description}
          onChange={(e): void => setDescription(e.target.value)}
          placeholder={`Lasă gol pentru a folosi descrierea principală pe ${mpName}.`}
        />
      </CardBlock>

      {/* Cost Template ID (Temu) */}
      {temu && (
        <CardBlock>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-900, #0b0d12)',
              marginBottom: 10,
            }}
          >
            Cost Template ID (Temu)
          </div>
          <input
            className={inputCls}
            style={{ height: 42, fontSize: 15 }}
            value={temuCostTemplateId}
            onChange={(e): void => setTemuCostTemplateId(e.target.value)}
            placeholder="ID-ul template-ului de transport (costTemplateId)..."
          />
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
            Shipping template ID din bg.freight.template.list.query.
          </div>
        </CardBlock>
      )}

      {/* Variații Temu — read-only, câmp separat deasupra caracteristicilor */}
      {temuVariations.length > 0 && (
        <CardBlock>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-900, #0b0d12)',
              marginBottom: 10,
            }}
          >
            Variații Temu ({temuVariations.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {temuVariations.map((v, i) => {
              const specName =
                typeof v.specName === 'string'
                  ? v.specName
                  : typeof v.name === 'string'
                    ? v.name
                    : `Variație ${i + 1}`;
              const asIdText = (raw: unknown): string =>
                typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
              const specId = asIdText(v.specId) || asIdText(v.parentSpecId);
              return (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom:
                      i < temuVariations.length - 1 ? '1px solid var(--ink-100, #f3f4f6)' : 'none',
                  }}
                >
                  <span
                    style={{ fontSize: 12.5, color: 'var(--ink-900, #0b0d12)', fontWeight: 500 }}
                  >
                    {specName}
                  </span>
                  <span
                    className="font-mono"
                    style={{ fontSize: 12.5, color: 'var(--ink-500, #6b7280)' }}
                  >
                    {specId}
                  </span>
                </div>
              );
            })}
          </div>
        </CardBlock>
      )}

      {/* Caracteristici din sincronizare */}
      {mpCharacteristics.length > 0 && (
        <CardBlock>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink-900, #0b0d12)',
              marginBottom: 10,
            }}
          >
            Caracteristici ({mpCharacteristics.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {mpCharacteristics.map((c, i) => {
              const name =
                typeof c.name === 'string'
                  ? c.name
                  : typeof c.tag === 'string'
                    ? c.tag
                    : `Caracteristică ${i + 1}`;
              const value = typeof c.value === 'string' ? c.value : JSON.stringify(c.value);
              return (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom:
                      i < mpCharacteristics.length - 1
                        ? '1px solid var(--ink-100, #f3f4f6)'
                        : 'none',
                  }}
                >
                  <span style={{ fontSize: 12.5, color: 'var(--ink-500, #6b7280)' }}>{name}</span>
                  <span
                    style={{ fontSize: 12.5, color: 'var(--ink-900, #0b0d12)', fontWeight: 500 }}
                  >
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        </CardBlock>
      )}

      {/* Preț */}
      <CardBlock>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-500, #6b7280)',
            marginBottom: 12,
          }}
        >
          Preț pe {mpName}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className={`${inputCls} font-mono`}
            type="number"
            step="0.01"
            value={priceAmount}
            onChange={(e): void => setPriceAmount(e.target.value)}
            style={{ fontSize: 18, fontWeight: 600, height: 44, letterSpacing: '-0.01em' }}
          />
          <span
            style={{
              height: 44,
              padding: '0 14px',
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 10,
              border: '1px solid var(--ink-200, #e5e7eb)',
              background: 'var(--ink-50, #f9fafb)',
              fontSize: 13,
              color: 'var(--ink-700, #374151)',
              fontWeight: 500,
            }}
          >
            {mpCurrency}
          </span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Preț specific pentru {mpName}. Suprascrie prețul principal.
        </div>
      </CardBlock>

      {/* Stoc marketplace */}
      <CardBlock>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ink-500, #6b7280)',
            marginBottom: 12,
          }}
        >
          Stoc pe {mpName}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            aria-label={`Stoc pe ${mpName}`}
            className={`${inputCls} font-mono`}
            type="number"
            step="1"
            min="0"
            value={stockQuantity === '' ? '' : stockQuantity}
            onChange={(e): void =>
              setStockQuantity(e.target.value === '' ? '' : Number(e.target.value))
            }
            style={{ fontSize: 18, fontWeight: 600, height: 44, letterSpacing: '-0.01em' }}
          />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
          Stoc specific pentru {mpName}. Lasă gol pentru a nu trimite stocul.
        </div>
      </CardBlock>

      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          background: 'var(--ink-50, #f9fafb)',
          border: '1px solid var(--ink-200, #e5e7eb)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <MPLogo name={logo} size={28} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900, #0b0d12)' }}>
            {mpName} — sincronizare activă
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-500, #6b7280)', marginTop: 2 }}>
            Datele de mai sus sunt trimise automat la fiecare sincronizare.
          </div>
        </div>
      </div>

      <SaveBar
        status={saveStatus}
        onSave={(): void => {
          void handleSave();
        }}
        errorMessage={saveError}
      />

      <RawDataPanel syncState={syncState} />
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function IdentificareSidebar({
  form,
}: {
  form: ReturnType<typeof useForm<ProductFormValues>>;
}): ReactElement {
  const {
    register,
    watch,
    formState: { errors },
  } = form;
  const stock = watch('stockQuantity');

  return (
    <CardBlock>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--ink-500, #6b7280)',
          marginBottom: 14,
        }}
      >
        Identificare & stoc
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* SKU */}
        <div>
          <FieldLabel>SKU</FieldLabel>
          <input
            aria-label="SKU"
            className={`${inputCls} font-mono`}
            placeholder="AV-XYZ-000"
            {...register('sku')}
          />
          {errors.sku?.message ? (
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--danger, #ef4444)' }}>
              {errors.sku.message}
            </p>
          ) : null}
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
            Cod intern, unic.
          </div>
        </div>

        {/* EAN */}
        <div>
          <FieldLabel optional>EAN / Cod de bare</FieldLabel>
          <input
            aria-label="EAN"
            className={`${inputCls} font-mono`}
            placeholder="13 cifre"
            {...register('ean')}
          />
        </div>

        {/* Brand */}
        <div>
          <FieldLabel optional>Brand / Producător</FieldLabel>
          <input
            aria-label="Brand"
            className={inputCls}
            placeholder="Ex: Samsung"
            {...register('brand')}
          />
        </div>

        <div style={{ height: 1, background: 'var(--ink-100, #f3f4f6)', margin: '4px 0' }} />

        {/* TVA */}
        <div>
          <FieldLabel optional>Cotă TVA</FieldLabel>
          <select aria-label="Cotă TVA" className={inputCls} {...register('vatRate')}>
            <option value="">— Selectează —</option>
            <option value="0">0%</option>
            <option value="5">5%</option>
            <option value="9">9%</option>
            <option value="19">19%</option>
          </select>
        </div>

        {/* Purchase price */}
        <div>
          <FieldLabel optional>Preț de achiziție</FieldLabel>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              aria-label="Preț de achiziție"
              className={`${inputCls} font-mono`}
              type="number"
              step="0.01"
              style={{ flex: 1 }}
              {...register('purchasePriceAmount')}
            />
            <span
              style={{
                height: 38,
                padding: '0 12px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 10,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: 'var(--ink-50, #f9fafb)',
                fontSize: 13,
                color: 'var(--ink-700, #374151)',
                fontWeight: 500,
              }}
            >
              {form.watch('priceCurrency')}
            </span>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
            Costul de achiziție, nu e afișat clienților.
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--ink-100, #f3f4f6)', margin: '4px 0' }} />

        {/* Stock */}
        <div>
          <FieldLabel>Stoc disponibil</FieldLabel>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              aria-label="Stoc"
              className={`${inputCls} font-mono`}
              type="number"
              style={{ flex: 1 }}
              {...register('stockQuantity')}
            />
            <span
              style={{
                height: 38,
                padding: '0 12px',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 10,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: 'var(--ink-50, #f9fafb)',
                fontSize: 13,
                color: 'var(--ink-700, #374151)',
                fontWeight: 500,
              }}
            >
              buc
            </span>
          </div>
          {errors.stockQuantity?.message ? (
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--danger, #ef4444)' }}>
              {errors.stockQuantity.message}
            </p>
          ) : null}
          <div
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 8,
              background:
                stock === 0
                  ? 'rgba(239,68,68,0.08)'
                  : stock < 20
                    ? 'rgba(245,158,11,0.08)'
                    : 'rgba(34,197,94,0.08)',
              color:
                stock === 0
                  ? 'var(--danger, #ef4444)'
                  : stock < 20
                    ? 'var(--warning, #f59e0b)'
                    : 'var(--success, #22c55e)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11.5,
              fontWeight: 500,
            }}
          >
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
              {stock === 0 || stock < 20 ? (
                <>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v6M12 17h.01" />
                </>
              ) : (
                <path d="m4 12 5 5L20 6" />
              )}
            </svg>
            {stock === 0
              ? 'Stoc epuizat — listările sunt suspendate'
              : stock < 20
                ? 'Stoc redus'
                : 'Stoc disponibil'}
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--ink-100, #f3f4f6)', margin: '4px 0' }} />

        {/* Warranty */}
        <div>
          <FieldLabel optional>Garanție (luni)</FieldLabel>
          <input
            aria-label="Garanție luni"
            className={`${inputCls} font-mono`}
            type="number"
            step="1"
            min="0"
            placeholder="24"
            {...register('warrantyMonths')}
          />
        </div>

        {/* Handling time */}
        <div>
          <FieldLabel optional>Timp procesare (zile)</FieldLabel>
          <input
            aria-label="Timp procesare zile"
            className={`${inputCls} font-mono`}
            type="number"
            step="1"
            min="0"
            max="30"
            placeholder="1"
            {...register('handlingTimeDays')}
          />
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-400, #9ca3af)' }}>
            Zile lucrătoare de la comandă la expediere.
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--ink-100, #f3f4f6)', margin: '4px 0' }} />

        {/* Active status */}
        <div>
          <FieldLabel>Status</FieldLabel>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" aria-label="Produs activ în catalog" {...register('isActive')} />
            <span style={{ fontSize: 13, color: 'var(--ink-700, #374151)' }}>
              Produs activ în catalog
            </span>
          </label>
        </div>
      </div>
    </CardBlock>
  );
}

// ── Simple create form (for new product page) ──────────────────────────────────

function CreateForm({ form, images, attributes }: PrincipalContentProps): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <PrincipalContent form={form} images={images} attributes={attributes} />
    </div>
  );
}

// ── Main ProductForm ───────────────────────────────────────────────────────────

export function ProductForm({ mode, initial }: ProductFormProps): ReactElement {
  const router = useRouter();
  // Return to the list where we came from (page + filters + scroll), not /products page 1.
  // Fall back to /products when opened directly (no in-app history, e.g. a shared link).
  const goBack = (): void => {
    if (window.history.length > 1) router.back();
    else router.push('/products');
  };
  const [serverError, setServerError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('principal');
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: buildDefaults(initial),
  });
  const images = useFieldArray({ control: form.control, name: 'images' });
  const attributes = useFieldArray({ control: form.control, name: 'attributes' });

  const isDirty = form.formState.isDirty;

  const MARKETPLACE_NAMES: Record<string, string> = {
    emag: 'eMAG',
    trendyol: 'Trendyol',
    temu: 'Temu',
  };

  const listings = initial?.listings ?? [];
  // One tab per marketplace code (emag-ro, trendyol-bg…), not per plugin.
  const channels = listings.map((l) => {
    const logo = packageToLogoName(l.pluginPackage);
    return {
      id: l.platform || logo,
      listingId: l.id,
      logo,
      label: l.platform ? marketplaceLabel(l.platform) : (MARKETPLACE_NAMES[logo] ?? logo),
      pluginPackage: l.pluginPackage,
      status: l.status,
      syncState: l.syncState,
    };
  });

  const tabs = [
    { id: 'principal', label: 'Principal', logo: '' },
    ...channels.map((c) => ({ id: c.id, label: c.label, logo: c.logo })),
  ];

  const tryNav = (dest: string): void => {
    if (isDirty) {
      setPendingNav(dest);
      return;
    }
    if (dest === '__back__') {
      goBack();
    } else {
      setActiveTab(dest);
    }
  };

  const doDiscard = (): void => {
    form.reset();
    const d = pendingNav;
    setPendingNav(null);
    if (d === '__back__') goBack();
    else if (d) setActiveTab(d);
  };

  async function doSave(): Promise<void> {
    const d = pendingNav;
    setPendingNav(null);
    await form.handleSubmit(onSubmit)();
    if (!form.formState.errors || Object.keys(form.formState.errors).length === 0) {
      if (d === '__back__') goBack();
      else if (d) setActiveTab(d);
    }
  }

  async function onSubmit(values: ProductFormValues): Promise<void> {
    setServerError(null);
    const attrEntries = values.attributes.map((a) => [a.key, a.value] as [string, string]);
    if (values.ean) attrEntries.push(['EAN', values.ean]);

    const payload: Record<string, unknown> = {
      name: values.name,
      description: values.description ?? null,
      priceAmountMinor: Math.round(values.priceAmount * 100).toString(),
      priceCurrency: values.priceCurrency,
      stockQuantity: values.stockQuantity,
      isActive: values.isActive,
      images: values.images,
      attributes: Object.fromEntries(attrEntries),
      brand: values.brand !== '' ? (values.brand ?? null) : null,
      ean: values.ean !== '' ? (values.ean ?? null) : null,
      vatRate: values.vatRate ?? null,
      purchasePriceAmountMinor:
        values.purchasePriceAmount > 0
          ? Math.round(values.purchasePriceAmount * 100).toString()
          : null,
      fullPriceAmountMinor:
        values.fullPriceAmount > 0 ? Math.round(values.fullPriceAmount * 100).toString() : null,
      weightGrams: values.weightGrams ?? null,
      heightMm: values.heightMm ?? null,
      widthMm: values.widthMm ?? null,
      lengthMm: values.lengthMm ?? null,
      warrantyMonths: values.warrantyMonths ?? null,
      handlingTimeDays: values.handlingTimeDays ?? null,
      numberOfPackages: values.numberOfPackages ?? null,
      sku: values.sku,
    };

    try {
      if (mode === 'create') {
        await getApiClient().post('/products', payload);
        router.push('/products');
        router.refresh();
      } else if (initial) {
        await getApiClient().patch(`/products/${initial.id}`, payload);
        form.reset(values);
        router.refresh();
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        setServerError('SKU-ul există deja.');
      } else if (e instanceof ApiError && e.code === 'VALIDATION_FAILED') {
        setServerError('Date invalide. Verifică câmpurile.');
      } else {
        setServerError('Eroare la salvare.');
      }
    }
  }

  // ── Create mode: simple full-width form ──────────────────────────────────────
  if (mode === 'create') {
    return (
      <form
        onSubmit={(e): void => {
          void form.handleSubmit(onSubmit)(e);
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 300px',
            gap: 18,
            alignItems: 'start',
          }}
        >
          <CreateForm form={form} images={images} attributes={attributes} />
          <div style={{ position: 'sticky', top: 0 }}>
            <IdentificareSidebar form={form} />
          </div>
        </div>
        {serverError ? (
          <p role="alert" style={{ fontSize: 13, color: 'var(--danger, #ef4444)' }}>
            {serverError}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="outline" onClick={(): void => router.push('/products')}>
            Anulează
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Se salvează…' : 'Salvează'}
          </Button>
        </div>
      </form>
    );
  }

  // ── Edit mode: full PageProductDetailMvp layout ───────────────────────────────
  const activeChannel = channels.find((c) => c.id === activeTab);
  const activeMpName = activeChannel ? activeChannel.label : '';
  const priceAmount = form.getValues('priceAmount');

  return (
    <>
      <form
        onSubmit={(e): void => {
          void form.handleSubmit(onSubmit)(e);
        }}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 0 }}
      >
        {/* ── Top bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button
            type="button"
            onClick={(): void => tryNav('__back__')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--ink-200, #e5e7eb)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--ink-600, #4b5563)',
              fontFamily: 'inherit',
              fontWeight: 500,
            }}
          >
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
              <path d="m15 6-6 6 6 6" />
            </svg>
            Înapoi la produse
          </button>
          <div style={{ flex: 1 }} />
          {initial?.id && (
            <button
              type="button"
              onClick={(): void => {
                void navigator.clipboard.writeText(
                  `${window.location.origin}/products/${initial.id}/edit`,
                );
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--ink-200, #e5e7eb)',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--ink-500, #6b7280)',
                fontFamily: 'inherit',
              }}
              title="Copiază link-ul acestui produs"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copiază link
            </button>
          )}
          {isDirty && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={(): void => form.reset()}>
                Renunță la modificări
              </Button>
              <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Se salvează…' : 'Salvează modificările'}
              </Button>
            </>
          )}
        </div>

        {/* ── Tabs ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid var(--ink-200, #e5e7eb)',
            marginBottom: 20,
          }}
        >
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={(): void => tryNav(t.id)}
                style={{
                  padding: '9px 16px',
                  border: 'none',
                  background: 'transparent',
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  color: active ? 'var(--ink-900, #0b0d12)' : 'var(--ink-500, #6b7280)',
                  borderBottom: `2px solid ${active ? 'var(--ink-900, #0b0d12)' : 'transparent'}`,
                  marginBottom: -1,
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                {t.id !== 'principal' && <MPLogo name={t.logo} size={16} />}
                {t.label}
              </button>
            );
          })}
        </div>

        {/* ── Page title ── */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--ink-900, #0b0d12)',
              lineHeight: 1.2,
            }}
          >
            {form.watch('name') || 'Produs nou'}
          </div>
          {activeTab !== 'principal' && (
            <div style={{ fontSize: 13, color: 'var(--ink-500, #6b7280)', marginTop: 5 }}>
              Date specifice pentru{' '}
              <strong style={{ color: 'var(--ink-700, #374151)' }}>{activeMpName}</strong>.
              Câmpurile lăsate goale folosesc datele principale.
            </div>
          )}
        </div>

        {/* ── 2-column layout ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 300px',
            gap: 18,
            alignItems: 'start',
          }}
        >
          {/* Left: tab content */}
          {activeTab === 'principal' ? (
            <PrincipalContent
              form={form}
              images={images}
              attributes={attributes}
              productId={initial?.id}
            />
          ) : (
            <MarketplaceContent
              // Remontează MarketplaceContent (și OfferStatusBanner) când syncState-ul
              // e reîmprospătat de un resync reușit (router.refresh() în handleResync),
              // ca titlul/prețul/stocul local să nu rămână pe valorile dinaintea resync-ului.
              key={`${activeTab}:${typeof activeChannel?.syncState.last_manual_resync_at === 'string' ? activeChannel.syncState.last_manual_resync_at : ''}`}
              listingId={activeChannel?.listingId ?? ''}
              channelId={activeTab}
              logo={activeChannel?.logo ?? ''}
              mpName={activeMpName}
              status={activeChannel?.status ?? ''}
              productName={form.watch('name')}
              productPrice={priceAmount}
              currency={form.watch('priceCurrency')}
              syncState={activeChannel?.syncState ?? {}}
            />
          )}

          {/* Right: sidebar */}
          <aside style={{ position: 'sticky', top: 0 }}>
            <IdentificareSidebar form={form} />
          </aside>
        </div>

        {serverError ? (
          <p role="alert" style={{ marginTop: 16, fontSize: 13, color: 'var(--danger, #ef4444)' }}>
            {serverError}
          </p>
        ) : null}
      </form>

      {/* ── Unsaved changes modal ── */}
      {pendingNav !== null && (
        <UnsavedModal
          onSave={(): void => {
            void doSave();
          }}
          onDiscard={doDiscard}
          onCancel={(): void => setPendingNav(null)}
        />
      )}
    </>
  );
}
