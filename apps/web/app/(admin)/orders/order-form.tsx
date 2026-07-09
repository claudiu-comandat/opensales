'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PackageSearch, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { ProductPickerModal, type PickedProduct } from './product-picker-modal.js';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { getApiClient } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';

// ─── Styles ────────────────────────────────────────────────────────────────

const inputClass =
  'h-[38px] w-full rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 placeholder:text-ink-400 transition-all duration-150 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:opacity-50';

const selectClass =
  'h-[38px] w-full rounded-[10px] border border-ink-200 bg-surface px-3 text-[13.5px] text-ink-900 transition-all duration-150 focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-500/15';

// ─── Helpers ────────────────────────────────────────────────────────────────

const stripEmpty = (v: unknown): unknown => (v === '' ? undefined : v);

// ─── Schema ─────────────────────────────────────────────────────────────────

const addressSchema = z.object({
  name: z.preprocess(stripEmpty, z.string().optional()),
  street: z.preprocess(stripEmpty, z.string().optional()),
  street2: z.preprocess(stripEmpty, z.string().optional()),
  city: z.preprocess(stripEmpty, z.string().optional()),
  county: z.preprocess(stripEmpty, z.string().optional()),
  country: z.preprocess(stripEmpty, z.string().optional()),
  zip: z.preprocess(stripEmpty, z.string().optional()),
  phone: z.preprocess(stripEmpty, z.string().optional()),
  email: z.preprocess(stripEmpty, z.string().optional()),
  company: z.preprocess(stripEmpty, z.string().optional()),
  vat_id: z.preprocess(stripEmpty, z.string().optional()),
});

const itemSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  sku: z.string().min(1, 'SKU obligatoriu'),
  name: z.string().min(1, 'Nume obligatoriu'),
  quantity: z.coerce.number().int().positive('≥ 1'),
  unitPriceAmount: z.coerce.number().min(0, '≥ 0'),
  unitPriceCurrency: z.string().length(3),
  vatRate: z.coerce.number().int().min(0).max(100),
});

const formSchema = z.object({
  customerName: z.preprocess(stripEmpty, z.string().optional()),
  customerEmail: z.preprocess(stripEmpty, z.string().email('Email invalid').optional()),
  customerPhone: z.preprocess(stripEmpty, z.string().optional()),
  placedAt: z.string().min(1, 'Data plasării obligatorie'),
  deliveryMode: z.preprocess(stripEmpty, z.enum(['courier', 'pickup']).optional()),
  paymentStatus: z.preprocess(stripEmpty, z.string().optional()),
  billingSameAsShipping: z.boolean(),
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  totalCurrency: z.string().length(3),
  items: z.array(itemSchema).min(1, 'Comanda trebuie să aibă cel puțin un produs'),
});

type FormValues = z.infer<typeof formSchema>;

interface CreatedOrder {
  id: string;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CardSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="rounded-[18px] border border-ink-200 bg-surface p-5 shadow-os-sm">
      <div className="mb-4">
        <div className="t-h3">{title}</div>
        {description ? <div className="t-micro mt-1">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-semibold text-ink-700">
        {label}
      </label>
      {children}
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}

// ─── Address fields sub-form ─────────────────────────────────────────────────

function AddressFields({
  prefix,
  form,
  showVatId = false,
}: {
  prefix: 'shippingAddress' | 'billingAddress';
  form: UseFormReturn<FormValues>;
  showVatId?: boolean;
}): ReactElement {
  const p = prefix;
  const errs = form.formState.errors[p];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Nume destinatar" htmlFor={`${p}.name`} error={errs?.name?.message}>
        <input id={`${p}.name`} {...form.register(`${p}.name`)} className={inputClass} />
      </Field>
      <Field label="Companie" htmlFor={`${p}.company`} error={errs?.company?.message}>
        <input id={`${p}.company`} {...form.register(`${p}.company`)} className={inputClass} />
      </Field>
      <Field label="Stradă" htmlFor={`${p}.street`} error={errs?.street?.message}>
        <input id={`${p}.street`} {...form.register(`${p}.street`)} className={inputClass} />
      </Field>
      <Field label="Stradă (linia 2)" htmlFor={`${p}.street2`}>
        <input id={`${p}.street2`} {...form.register(`${p}.street2`)} className={inputClass} />
      </Field>
      <Field label="Oraș" htmlFor={`${p}.city`}>
        <input id={`${p}.city`} {...form.register(`${p}.city`)} className={inputClass} />
      </Field>
      <Field label="Județ / Regiune" htmlFor={`${p}.county`}>
        <input id={`${p}.county`} {...form.register(`${p}.county`)} className={inputClass} />
      </Field>
      <Field label="Cod poștal" htmlFor={`${p}.zip`}>
        <input id={`${p}.zip`} {...form.register(`${p}.zip`)} className={inputClass} />
      </Field>
      <Field label="Țară" htmlFor={`${p}.country`}>
        <input
          id={`${p}.country`}
          {...form.register(`${p}.country`)}
          className={inputClass}
          placeholder="RO"
        />
      </Field>
      <Field label="Telefon" htmlFor={`${p}.phone`}>
        <input id={`${p}.phone`} {...form.register(`${p}.phone`)} className={inputClass} />
      </Field>
      <Field label="Email" htmlFor={`${p}.email`}>
        <input id={`${p}.email`} {...form.register(`${p}.email`)} className={inputClass} />
      </Field>
      {showVatId ? (
        <Field label="CUI / VAT ID" htmlFor={`${p}.vat_id`}>
          <input id={`${p}.vat_id`} {...form.register(`${p}.vat_id`)} className={inputClass} />
        </Field>
      ) : null}
    </div>
  );
}

// ─── Total calculator ────────────────────────────────────────────────────────

function OrderTotal({ form }: { form: ReturnType<typeof useForm<FormValues>> }): ReactElement {
  const items = useWatch({ control: form.control, name: 'items' });
  const currency = useWatch({ control: form.control, name: 'totalCurrency' });

  const subtotal = items.reduce((acc, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPriceAmount) || 0;
    return acc + qty * price;
  }, 0);

  return (
    <div className="flex items-center justify-between rounded-[12px] bg-ink-50 px-4 py-3">
      <span className="text-[13px] font-semibold text-ink-700">Total comandă (fără TVA)</span>
      <span className="font-mono text-[15px] font-bold text-ink-900">
        {subtotal.toFixed(2)} {currency}
      </span>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function OrderForm(): ReactElement {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      placedAt: new Date().toISOString().slice(0, 16),
      deliveryMode: undefined,
      paymentStatus: '',
      billingSameAsShipping: true,
      shippingAddress: {},
      billingAddress: {},
      totalCurrency: 'RON',
      items: [],
    },
  });

  const items = useFieldArray({ control: form.control, name: 'items' });
  const billingSame = useWatch({ control: form.control, name: 'billingSameAsShipping' });

  function handleProductPicked(product: PickedProduct): void {
    items.append({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: 1,
      unitPriceAmount: product.priceAmountMinor / 100,
      unitPriceCurrency: product.priceCurrency,
      vatRate: product.vatRate ?? 0,
    });
  }

  async function onSubmit(values: FormValues): Promise<void> {
    setSubmitError(null);

    const subtotalMinor = Math.round(
      values.items.reduce((acc, it) => acc + Number(it.quantity) * Number(it.unitPriceAmount), 0) *
        100,
    );

    const billingAddr = values.billingSameAsShipping
      ? values.shippingAddress
      : values.billingAddress;

    const payload = {
      totalAmountMinor: subtotalMinor,
      totalCurrency: values.totalCurrency.toUpperCase(),
      customerEmail: values.customerEmail,
      customerPhone: values.customerPhone,
      customerName: values.customerName,
      billingAddress: billingAddr,
      shippingAddress: values.shippingAddress,
      deliveryMode: values.deliveryMode,
      paymentStatus: values.paymentStatus,
      placedAt: new Date(values.placedAt).toISOString(),
      items: values.items.map((it) => ({
        productId: it.productId ?? null,
        sku: it.sku,
        name: it.name,
        quantity: Number(it.quantity),
        unitPriceAmountMinor: Math.round(Number(it.unitPriceAmount) * 100),
        unitPriceCurrency: it.unitPriceCurrency.toUpperCase(),
        attributes: { vatRate: it.vatRate },
      })),
    };

    try {
      const created = await getApiClient().post<CreatedOrder>('/orders', payload);
      router.push(`/orders/${created.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        setSubmitError(e.message || `Eroare ${e.status}`);
      } else {
        setSubmitError('Eroare la crearea comenzii. Încearcă din nou.');
      }
    }
  }

  return (
    <>
      {pickerOpen ? (
        <ProductPickerModal onSelect={handleProductPicked} onClose={() => setPickerOpen(false)} />
      ) : null}

      <form
        onSubmit={(e) => {
          void form.handleSubmit(onSubmit)(e);
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        {/* ── Client ── */}
        <CardSection title="Client">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Nume" htmlFor="customerName">
              <input id="customerName" {...form.register('customerName')} className={inputClass} />
            </Field>
            <Field
              label="Email"
              htmlFor="customerEmail"
              error={form.formState.errors.customerEmail?.message}
            >
              <input
                id="customerEmail"
                type="email"
                {...form.register('customerEmail')}
                className={inputClass}
              />
            </Field>
            <Field label="Telefon" htmlFor="customerPhone">
              <input
                id="customerPhone"
                {...form.register('customerPhone')}
                className={inputClass}
              />
            </Field>
            <Field
              label="Data plasării"
              htmlFor="placedAt"
              error={form.formState.errors.placedAt?.message}
            >
              <input
                id="placedAt"
                type="datetime-local"
                {...form.register('placedAt')}
                className={inputClass}
              />
            </Field>
            <Field label="Mod livrare" htmlFor="deliveryMode">
              <select id="deliveryMode" {...form.register('deliveryMode')} className={selectClass}>
                <option value="">— nespecificat —</option>
                <option value="courier">Curier la domiciliu</option>
                <option value="pickup">Locker / Ridicare</option>
              </select>
            </Field>
            <Field label="Modalitate plată" htmlFor="paymentStatus">
              <select
                id="paymentStatus"
                {...form.register('paymentStatus')}
                className={selectClass}
              >
                <option value="">— nespecificat —</option>
                <option value="ramburs">Ramburs</option>
                <option value="card">Card online</option>
                <option value="transfer">Transfer bancar</option>
              </select>
            </Field>
          </div>
        </CardSection>

        {/* ── Adresă livrare ── */}
        <CardSection title="Adresă de livrare">
          <AddressFields prefix="shippingAddress" form={form} />
        </CardSection>

        {/* ── Adresă facturare ── */}
        <CardSection title="Adresă de facturare">
          <label className="mb-4 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              {...form.register('billingSameAsShipping')}
              className="h-4 w-4 rounded border-ink-300 accent-brand-600"
            />
            <span className="text-[13px] text-ink-700">Aceeași ca adresa de livrare</span>
          </label>
          {!billingSame ? <AddressFields prefix="billingAddress" form={form} showVatId /> : null}
        </CardSection>

        {/* ── Produse ── */}
        <CardSection
          title="Produse"
          description="Adaugă produsele din catalogul OpenSales sau completează manual."
        >
          <div className="flex flex-col gap-3">
            {items.fields.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-ink-200 py-6 text-center text-[13px] text-ink-400">
                Niciun produs adăugat încă.
              </p>
            ) : null}

            {/* Items header */}
            {items.fields.length > 0 ? (
              <div className="hidden grid-cols-[1fr_2fr_70px_110px_80px_70px_36px] gap-2 px-2 md:grid">
                {['SKU', 'Nume', 'Cant.', 'Preț unit.', 'Monedă', 'TVA %', ''].map((h) => (
                  <span
                    key={h}
                    className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400"
                  >
                    {h}
                  </span>
                ))}
              </div>
            ) : null}

            {items.fields.map((field, idx) => (
              <div
                key={field.id}
                className="grid grid-cols-1 gap-2 rounded-[12px] border border-ink-100 bg-ink-50/30 p-3 md:grid-cols-[1fr_2fr_70px_110px_80px_70px_36px] md:items-end md:rounded-none md:border-0 md:bg-transparent md:p-0"
              >
                <Field
                  label="SKU"
                  htmlFor={`items.${idx}.sku`}
                  error={form.formState.errors.items?.[idx]?.sku?.message}
                >
                  <input
                    id={`items.${idx}.sku`}
                    {...form.register(`items.${idx}.sku`)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Nume"
                  htmlFor={`items.${idx}.name`}
                  error={form.formState.errors.items?.[idx]?.name?.message}
                >
                  <input
                    id={`items.${idx}.name`}
                    {...form.register(`items.${idx}.name`)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Cant."
                  htmlFor={`items.${idx}.quantity`}
                  error={form.formState.errors.items?.[idx]?.quantity?.message}
                >
                  <input
                    id={`items.${idx}.quantity`}
                    type="number"
                    min={1}
                    {...form.register(`items.${idx}.quantity`)}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Preț unit."
                  htmlFor={`items.${idx}.unitPriceAmount`}
                  error={form.formState.errors.items?.[idx]?.unitPriceAmount?.message}
                >
                  <input
                    id={`items.${idx}.unitPriceAmount`}
                    type="number"
                    step="0.01"
                    min={0}
                    {...form.register(`items.${idx}.unitPriceAmount`)}
                    className={inputClass}
                  />
                </Field>
                <Field label="Mon." htmlFor={`items.${idx}.unitPriceCurrency`}>
                  <input
                    id={`items.${idx}.unitPriceCurrency`}
                    maxLength={3}
                    {...form.register(`items.${idx}.unitPriceCurrency`)}
                    className={inputClass}
                  />
                </Field>
                <Field label="TVA %" htmlFor={`items.${idx}.vatRate`}>
                  <select
                    id={`items.${idx}.vatRate`}
                    {...form.register(`items.${idx}.vatRate`)}
                    className={selectClass}
                  >
                    <option value={0}>0%</option>
                    <option value={5}>5%</option>
                    <option value={9}>9%</option>
                    <option value={19}>19%</option>
                    <option value={21}>21%</option>
                  </select>
                </Field>
                <div className="flex items-end justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => items.remove(idx)}
                    aria-label="Șterge produs"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {form.formState.errors.items?.message ? (
              <span className="text-[11px] text-danger">{form.formState.errors.items.message}</span>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setPickerOpen(true)}
            >
              <PackageSearch className="h-4 w-4" />
              Adaugă produs
            </Button>
          </div>

          {/* Auto-calculated total */}
          {items.fields.length > 0 ? (
            <div className="mt-4">
              <OrderTotal form={form} />
            </div>
          ) : null}
        </CardSection>

        {submitError ? (
          <p role="alert" className="text-[13px] text-danger">
            {submitError}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Se salvează…' : 'Salvează comanda'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Anulează
          </Button>
        </div>
      </form>
    </>
  );
}
