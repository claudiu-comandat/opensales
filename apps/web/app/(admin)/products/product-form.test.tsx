import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OfferStatusBanner,
  ProductForm,
  RawDataPanel,
  type ProductFormInitial,
} from './product-form.js';

import { ApiError } from '@/lib/api-types';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { push: typeof pushMock; refresh: typeof refreshMock } => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

const postMock = vi.fn();
const patchMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  getApiClient: (): { post: typeof postMock; patch: typeof patchMock } => ({
    post: postMock,
    patch: patchMock,
  }),
}));

const sampleInitial: ProductFormInitial = {
  id: 'p-1',
  sku: 'SKU-EXIST',
  name: 'Existing Product',
  description: 'Old description',
  price: { amountMinor: '12345', currency: 'RON' },
  stockQuantity: 7,
  images: [{ url: 'https://example.com/a.png', alt: 'Pic' }],
  attributes: { color: 'red' },
  isActive: false,
};

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  postMock.mockReset();
  patchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── RawDataPanel ───────────────────────────────────────────────────────────────

describe('RawDataPanel', () => {
  it('renders null when both raw_marketplace and raw_import are absent', () => {
    const { container } = render(<RawDataPanel syncState={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when both keys are explicitly null', () => {
    const { container } = render(
      <RawDataPanel syncState={{ raw_marketplace: null, raw_import: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders <details> with "De la marketplace" section when raw_marketplace is present', () => {
    render(<RawDataPanel syncState={{ raw_marketplace: { foo: 1 } }} />);
    expect(screen.getByText(/Date brute ofertă/i)).toBeInTheDocument();
    expect(screen.getByText(/De la marketplace/i)).toBeInTheDocument();
    expect(document.body.innerHTML).toContain('"foo"');
    expect(document.body.innerHTML).not.toContain('Importat de utilizator');
  });

  it('renders "Importat de utilizator" section when raw_import is present', () => {
    render(<RawDataPanel syncState={{ raw_import: { title: 'test', price: '999' } }} />);
    expect(screen.getByText(/Importat de utilizator/i)).toBeInTheDocument();
    expect(document.body.innerHTML).toContain('"title"');
    expect(document.body.innerHTML).not.toContain('De la marketplace');
  });

  it('renders both sections when both keys are present', () => {
    render(
      <RawDataPanel syncState={{ raw_marketplace: { mp: true }, raw_import: { imp: true } }} />,
    );
    expect(screen.getByText(/De la marketplace/i)).toBeInTheDocument();
    expect(screen.getByText(/Importat de utilizator/i)).toBeInTheDocument();
    expect(document.body.innerHTML).toContain('"mp"');
    expect(document.body.innerHTML).toContain('"imp"');
  });
});

describe('ProductForm (create mode)', () => {
  it('shows validation errors when SKU and name are empty', async () => {
    const user = userEvent.setup();
    render(<ProductForm mode="create" />);
    await user.click(screen.getByRole('button', { name: /salvează/i }));
    expect(await screen.findByText(/SKU obligatoriu/i)).toBeInTheDocument();
    expect(await screen.findByText(/Numele e obligatoriu/i)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('submits valid data with POST and redirects to /products', async () => {
    postMock.mockResolvedValueOnce({ id: 'new-id' });
    const user = userEvent.setup();
    render(<ProductForm mode="create" />);

    await user.type(screen.getByLabelText(/SKU/i), 'SKU-NEW');
    await user.type(screen.getByLabelText(/^Nume$/i), 'New Product');
    const priceInput = screen.getByLabelText(/^Preț$/i);
    await user.clear(priceInput);
    await user.type(priceInput, '12.34');
    const stockInput = screen.getByLabelText(/^Stoc$/i);
    await user.clear(stockInput);
    await user.type(stockInput, '5');

    await user.click(screen.getByRole('button', { name: /salvează/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({
        sku: 'SKU-NEW',
        name: 'New Product',
        priceAmountMinor: '1234',
        priceCurrency: 'RON',
        stockQuantity: 5,
        isActive: true,
        images: [],
        attributes: {},
      }),
    );
    expect(pushMock).toHaveBeenCalledWith('/products');
  });

  it('shows specific message when SKU already exists (CONFLICT)', async () => {
    postMock.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'CONFLICT', message: 'sku exists' } }),
    );
    const user = userEvent.setup();
    render(<ProductForm mode="create" />);
    await user.type(screen.getByLabelText(/SKU/i), 'SKU-DUP');
    await user.type(screen.getByLabelText(/^Nume$/i), 'Anything');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/SKU-ul există deja/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('appends image rows when clicking add image', async () => {
    const user = userEvent.setup();
    render(<ProductForm mode="create" />);
    expect(screen.getByTestId('images-empty')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /adaugă imagine/i }));
    expect(screen.getByLabelText(/URL imagine 1/i)).toBeInTheDocument();
  });

  it('appends attribute rows when clicking add attribute', async () => {
    const user = userEvent.setup();
    render(<ProductForm mode="create" />);
    expect(screen.getByTestId('attributes-empty')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /adaugă atribut/i }));
    expect(screen.getByLabelText(/Cheie atribut 1/i)).toBeInTheDocument();
  });
});

describe('SetAllOffersPrice control', () => {
  it('calls POST /products/:id/price with amountMinor when clicking Aplică pe toate', async () => {
    postMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={sampleInitial} />);

    const priceAllInput = screen.getByLabelText(/Preț pentru toate ofertele/i);
    await user.clear(priceAllInput);
    await user.type(priceAllInput, '357');

    await user.click(screen.getByRole('button', { name: /Aplică pe toate/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock).toHaveBeenCalledWith('/products/p-1/price', { amountMinor: '35700' });
  });

  it('shows success message after successful price apply', async () => {
    postMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={sampleInitial} />);

    const priceAllInput = screen.getByLabelText(/Preț pentru toate ofertele/i);
    await user.clear(priceAllInput);
    await user.type(priceAllInput, '100');

    await user.click(screen.getByRole('button', { name: /Aplică pe toate/i }));

    expect(await screen.findByText(/Aplicat cu succes/i)).toBeInTheDocument();
  });

  it('shows error message when POST fails', async () => {
    postMock.mockRejectedValueOnce(new Error('network error'));
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={sampleInitial} />);

    const priceAllInput = screen.getByLabelText(/Preț pentru toate ofertele/i);
    await user.clear(priceAllInput);
    await user.type(priceAllInput, '50');

    await user.click(screen.getByRole('button', { name: /Aplică pe toate/i }));

    expect(await screen.findByText(/Eroare la aplicarea prețului/i)).toBeInTheDocument();
  });

  it('is not shown in create mode', () => {
    render(<ProductForm mode="create" />);
    expect(screen.queryByLabelText(/Preț pentru toate ofertele/i)).not.toBeInTheDocument();
  });
});

describe('ProductForm (edit mode)', () => {
  it('allows editing SKU and pre-populates fields from initial', () => {
    render(<ProductForm mode="edit" initial={sampleInitial} />);
    const skuInput = screen.getByLabelText(/SKU/i);
    expect(skuInput).not.toBeDisabled();
    expect(skuInput).toHaveValue('SKU-EXIST');
    expect(screen.getByLabelText(/^Nume$/i)).toHaveValue('Existing Product');
    expect(screen.getByLabelText(/^Preț$/i)).toHaveValue(123.45);
    expect(screen.getByLabelText(/^Stoc$/i)).toHaveValue(7);
    expect(screen.getByLabelText(/Produs activ în catalog/i)).not.toBeChecked();
    expect(screen.getByLabelText(/URL imagine 1/i)).toHaveValue('https://example.com/a.png');
    expect(screen.getByLabelText(/Cheie atribut 1/i)).toHaveValue('color');
    expect(screen.getByLabelText(/Valoare atribut 1/i)).toHaveValue('red');
  });

  it('submits with PATCH to /products/:id including the (unchanged) sku', async () => {
    patchMock.mockResolvedValueOnce({ id: 'p-1' });
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={sampleInitial} />);
    const nameInput = screen.getByLabelText(/^Nume$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledTimes(1);
    });
    const [path, payload] = patchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/products/p-1');
    expect(payload.sku).toBe('SKU-EXIST');
    expect(payload.name).toBe('Renamed');
    expect(payload.priceAmountMinor).toBe('12345');
    expect(payload.attributes).toEqual({ color: 'red' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('submits a changed SKU (propagates new part_number to eMAG)', async () => {
    patchMock.mockResolvedValueOnce({ id: 'p-1' });
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={sampleInitial} />);
    const skuInput = screen.getByLabelText(/SKU/i);
    await user.clear(skuInput);
    await user.type(skuInput, 'SKU-RENAMED');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = patchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.sku).toBe('SKU-RENAMED');
  });

  it('shows specific message when the new SKU conflicts with another product (CONFLICT)', async () => {
    patchMock.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'CONFLICT', message: 'sku exists' } }),
    );
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={sampleInitial} />);
    const skuInput = screen.getByLabelText(/SKU/i);
    await user.clear(skuInput);
    await user.type(skuInput, 'SKU-TAKEN');
    await user.click(screen.getByRole('button', { name: /salvează/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/SKU-ul există deja/i);
  });

  it('shows generic error when API returns unknown failure', async () => {
    patchMock.mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'oops' } }),
    );
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={sampleInitial} />);
    // Dirty the form so the Save button becomes visible
    await user.type(screen.getByLabelText(/^Nume$/i), 'x');
    await user.click(screen.getByRole('button', { name: /salvează/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Eroare la salvare/i);
  });
});

// ── OfferStatusBanner ──────────────────────────────────────────────────────────

describe('OfferStatusBanner', () => {
  it('shows the listing status badge', () => {
    render(<OfferStatusBanner listingId="l1" mpName="eMAG RO" status="error" syncState={{}} />);
    expect(screen.getByTestId('offer-status-badge')).toHaveTextContent(/eroare/i);
  });

  it('shows the eMAG/Temu error message from syncState.last_error.message', () => {
    render(
      <OfferStatusBanner
        listingId="l1"
        mpName="eMAG RO"
        status="error"
        syncState={{ last_error: { message: 'eMAG: vat_id invalid', at: '2026-06-10T10:00:00Z' } }}
      />,
    );
    expect(screen.getByTestId('offer-error')).toHaveTextContent(/vat_id invalid/);
  });

  it('renders push_failure_reasons and reject_reasons lists (Trendyol)', () => {
    render(
      <OfferStatusBanner
        listingId="l1"
        mpName="Trendyol RO"
        status="rejected"
        syncState={{
          push_failure_reasons: ['Missing attribute 47'],
          reject_reasons: ['Doc invalid'],
        }}
      />,
    );
    const box = screen.getByTestId('offer-error');
    expect(box).toHaveTextContent(/Missing attribute 47/);
    expect(box).toHaveTextContent(/Doc invalid/);
  });

  it('does not render the error box when there is no error', () => {
    render(<OfferStatusBanner listingId="l1" mpName="eMAG RO" status="active" syncState={{}} />);
    expect(screen.queryByTestId('offer-error')).not.toBeInTheDocument();
  });

  it('triggers POST /listings/:id/repush when clicking the push button', async () => {
    postMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <OfferStatusBanner listingId="lst-emag-9" mpName="eMAG RO" status="error" syncState={{}} />,
    );
    await user.click(screen.getByTestId('offer-repush-btn'));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith('/listings/lst-emag-9/repush');
  });

  it('hides the push button for read-only (ECC-mirrored) offers', () => {
    render(
      <OfferStatusBanner
        listingId="l1"
        mpName="Trendyol BG"
        status="active"
        syncState={{ read_only: true }}
      />,
    );
    expect(screen.queryByTestId('offer-repush-btn')).not.toBeInTheDocument();
  });

  it('runs the sync diagnostic and shows the trace conclusion + steps', async () => {
    postMock.mockResolvedValueOnce({
      conclusion: 'eMAG product_offer/save a fost apelat cu SUCCES sincron.',
      apiInvoked: true,
      steps: [
        { step: 'load listing', ok: true, detail: 'platform=emag-ro' },
        {
          step: 'invoke eMAG pushOffers → product_offer/save',
          ok: true,
          detail: 'apel API reușit',
        },
      ],
      error: null,
    });
    const user = userEvent.setup();
    render(
      <OfferStatusBanner listingId="lst-emag-7" mpName="eMAG RO" status="error" syncState={{}} />,
    );
    await user.click(screen.getByTestId('offer-diagnostic-btn'));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith('/debug/push-offer/lst-emag-7');
    const result = await screen.findByTestId('offer-diagnostic-result');
    expect(result).toHaveTextContent(/SUCCES sincron/);
    expect(result).toHaveTextContent(/product_offer\/save/);
  });

  it('shows the raw error when the diagnostic reports a failed API call', async () => {
    postMock.mockResolvedValueOnce({
      conclusion: 'Apelul eMAG product_offer/save a EȘUAT sincron.',
      apiInvoked: true,
      steps: [],
      error: 'eMAG 401 Unauthorized',
    });
    const user = userEvent.setup();
    render(<OfferStatusBanner listingId="l1" mpName="eMAG RO" status="error" syncState={{}} />);
    await user.click(screen.getByTestId('offer-diagnostic-btn'));
    const result = await screen.findByTestId('offer-diagnostic-result');
    expect(result).toHaveTextContent(/401 Unauthorized/);
  });
});

// ── MarketplaceContent — status banner integration ─────────────────────────────

describe('MarketplaceContent — status + error banner', () => {
  it('shows the eMAG offer error message + push button on its tab', async () => {
    const user = userEvent.setup();
    const initial: ProductFormInitial = {
      ...sampleInitial,
      listings: [
        {
          id: 'lst-emag-err',
          pluginId: 'plugin-emag',
          pluginPackage: 'emag',
          platform: 'emag-ro',
          status: 'error',
          syncState: {
            title: 'T',
            price_amount_minor: '1000',
            price_currency: 'RON',
            last_error: {
              message: 'eMAG a respins oferta: vat_id invalid',
              at: '2026-06-10T10:00:00Z',
            },
          },
        },
      ],
    };
    render(<ProductForm mode="edit" initial={initial} />);
    const tabBtn = screen.getAllByRole('button').find((b) => /emag/i.test(b.textContent ?? ''));
    if (!tabBtn) throw new Error('eMAG tab button not found');
    await user.click(tabBtn);
    expect(await screen.findByTestId('offer-error')).toHaveTextContent(/vat_id invalid/);
    expect(screen.getByTestId('offer-repush-btn')).toBeInTheDocument();
  });
});

// ── Per-offer stock field (TrendyolTabContent) ─────────────────────────────────

describe('TrendyolTabContent — per-offer stock field', () => {
  const trendyolInitial: ProductFormInitial = {
    ...sampleInitial,
    listings: [
      {
        id: 'lst-trendyol-1',
        pluginId: 'plugin-trendyol',
        pluginPackage: 'trendyol',
        platform: 'trendyol-ro',
        status: 'active',
        syncState: {
          title: 'Titlu Trendyol',
          description: 'Descriere Trendyol',
          price_amount_minor: '9999',
          price_currency: 'TRY',
          stock_quantity: 10,
        },
      },
    ],
  };

  it('renders Stoc input pre-populated from syncState.stock_quantity', async () => {
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={trendyolInitial} />);
    await user.click(screen.getByRole('button', { name: /trendyol/i }));
    const stockInput = await screen.findByLabelText(/Stoc pe Trendyol/i);
    expect(stockInput).toHaveValue(10);
  });

  it('sends stock_quantity in PATCH when field is filled and Salvează is clicked', async () => {
    patchMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={trendyolInitial} />);
    await user.click(screen.getByRole('button', { name: /trendyol/i }));
    const stockInput = await screen.findByLabelText(/Stoc pe Trendyol/i);
    await user.clear(stockInput);
    await user.type(stockInput, '42');
    await user.click(screen.getByRole('button', { name: /Salvează modificările/i }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith(
      '/listings/lst-trendyol-1/sync-state',
      expect.objectContaining({ stock_quantity: 42 }),
    );
  });

  it('omits stock_quantity from PATCH when field is empty', async () => {
    patchMock.mockResolvedValueOnce(undefined);
    const initialNoStock: ProductFormInitial = {
      ...sampleInitial,
      listings: [
        {
          id: 'lst-trendyol-2',
          pluginId: 'plugin-trendyol',
          pluginPackage: 'trendyol',
          platform: 'trendyol-ro',
          status: 'active',
          syncState: {
            title: 'T',
            description: 'D',
            price_amount_minor: '1000',
            price_currency: 'TRY',
          },
        },
      ],
    };
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={initialNoStock} />);
    await user.click(screen.getByRole('button', { name: /trendyol/i }));
    await screen.findByLabelText(/Stoc pe Trendyol/i);
    await user.click(screen.getByRole('button', { name: /Salvează modificările/i }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    const body = patchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('stock_quantity');
  });
});

// ── Per-offer stock field (MarketplaceContent — non-Trendyol) ──────────────────

describe('MarketplaceContent — per-offer stock field', () => {
  const emaProInitial: ProductFormInitial = {
    ...sampleInitial,
    listings: [
      {
        id: 'lst-emag-1',
        pluginId: 'plugin-emag',
        pluginPackage: 'emag',
        platform: 'emag-ro',
        status: 'active',
        syncState: {
          title: 'Titlu eMAG',
          description: 'Descriere eMAG',
          price_amount_minor: '19999',
          price_currency: 'RON',
          stock_quantity: 5,
        },
      },
    ],
  };

  it('renders Stoc input pre-populated from syncState.stock_quantity', async () => {
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={emaProInitial} />);
    // Tab label for emag-ro comes from marketplaceLabel or MARKETPLACE_NAMES; click by partial text
    const tabBtn = screen.getAllByRole('button').find((b) => /emag/i.test(b.textContent ?? ''));
    if (!tabBtn) throw new Error('eMAG tab button not found');
    await user.click(tabBtn);
    const stockInput = await screen.findByLabelText(/Stoc pe/i);
    expect(stockInput).toHaveValue(5);
  });

  it('sends stock_quantity in PATCH when field is filled and Salvează is clicked', async () => {
    patchMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={emaProInitial} />);
    const tabBtn = screen.getAllByRole('button').find((b) => /emag/i.test(b.textContent ?? ''));
    if (!tabBtn) throw new Error('eMAG tab button not found');
    await user.click(tabBtn);
    const stockInput = await screen.findByLabelText(/Stoc pe/i);
    await user.clear(stockInput);
    await user.type(stockInput, '77');
    await user.click(screen.getByRole('button', { name: /Salvează modificările/i }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith(
      '/listings/lst-emag-1/sync-state',
      expect.objectContaining({ stock_quantity: 77 }),
    );
  });

  it('omits stock_quantity from PATCH when field is empty', async () => {
    patchMock.mockResolvedValueOnce(undefined);
    const initialNoStock: ProductFormInitial = {
      ...sampleInitial,
      listings: [
        {
          id: 'lst-emag-2',
          pluginId: 'plugin-emag',
          pluginPackage: 'emag',
          platform: 'emag-ro',
          status: 'active',
          syncState: {
            title: 'T',
            description: 'D',
            price_amount_minor: '5000',
            price_currency: 'RON',
          },
        },
      ],
    };
    const user = userEvent.setup();
    render(<ProductForm mode="edit" initial={initialNoStock} />);
    const tabBtn = screen.getAllByRole('button').find((b) => /emag/i.test(b.textContent ?? ''));
    if (!tabBtn) throw new Error('eMAG tab button not found');
    await user.click(tabBtn);
    await screen.findByLabelText(/Stoc pe/i);
    await user.click(screen.getByRole('button', { name: /Salvează modificările/i }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    const body = patchMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('stock_quantity');
  });
});
