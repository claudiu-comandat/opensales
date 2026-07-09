import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductsTable, type ProductRow } from './products-table.js';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { replace: typeof replaceMock } => ({ replace: replaceMock }),
  useSearchParams: (): URLSearchParams => new URLSearchParams(''),
}));

const defaultStats = {
  totalProducts: 2,
  totalStock: 5,
  lowStockCount: 0,
  noStockCount: 1,
};

const baseRows: ProductRow[] = [
  {
    id: '1',
    sku: 'SKU-1',
    name: 'Product One',
    price: { amountMinor: '12345', currency: 'RON' },
    stockQuantity: 5,
    isActive: true,
    images: [],
    // has an active listing → badge shows "Activ"
    listings: [
      {
        id: 'l1',
        pluginId: 'p1',
        pluginPackage: 'emag',
        platform: 'emag-ro',
        status: 'active',
        syncState: { price_amount_minor: '12345', price_currency: 'RON' },
      },
    ],
  },
  {
    id: '2',
    sku: 'SKU-2',
    name: 'Product Two',
    price: { amountMinor: '999', currency: 'RON' },
    stockQuantity: 0,
    isActive: false,
    images: [],
    listings: [], // no listings → badge shows "Inactiv"
  },
];

afterEach(() => {
  replaceMock.mockReset();
});

describe('ProductsTable', () => {
  it('renders rows for every product', () => {
    render(
      <ProductsTable
        rows={baseRows}
        total={baseRows.length}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={defaultStats}
      />,
    );
    expect(screen.getByTestId('product-row-SKU-1')).toBeInTheDocument();
    expect(screen.getByTestId('product-row-SKU-2')).toBeInTheDocument();
    expect(screen.getByText('Product One')).toBeInTheDocument();
    expect(screen.getByText('Activ')).toBeInTheDocument();
    expect(screen.getByText('Inactiv')).toBeInTheDocument();
  });

  it('shows empty state when no rows are provided', () => {
    render(
      <ProductsTable
        rows={[]}
        total={0}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={{ totalProducts: 0, totalStock: 0, lowStockCount: 0, noStockCount: 0 }}
      />,
    );
    expect(screen.getByTestId('products-empty')).toBeInTheDocument();
  });

  it('disables pagination buttons at boundaries', () => {
    render(
      <ProductsTable
        rows={baseRows}
        total={baseRows.length}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={defaultStats}
      />,
    );
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /următor/i })).toBeDisabled();
  });

  it('enables pagination next when more pages exist', () => {
    render(
      <ProductsTable
        rows={baseRows}
        total={120}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={defaultStats}
      />,
    );
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /următor/i })).not.toBeDisabled();
  });

  it('navigates next page on click', async () => {
    const user = userEvent.setup();
    render(
      <ProductsTable
        rows={baseRows}
        total={120}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={defaultStats}
      />,
    );
    await user.click(screen.getByRole('button', { name: /următor/i }));
    expect(replaceMock).toHaveBeenCalledWith('/products?page=2');
  });

  it('debounces search input and updates the URL', async () => {
    const user = userEvent.setup();
    render(
      <ProductsTable
        rows={baseRows}
        total={baseRows.length}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={defaultStats}
      />,
    );
    const input = screen.getByLabelText(/caută produse/i);
    await user.type(input, 'foo');
    await waitFor(
      () => {
        expect(replaceMock).toHaveBeenCalledWith('/products?search=foo&relevantOnly=false');
      },
      { timeout: 1000 },
    );
  });

  it('updates the URL when changing the status filter', async () => {
    const user = userEvent.setup();
    render(
      <ProductsTable
        rows={baseRows}
        total={baseRows.length}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={defaultStats}
      />,
    );
    await user.selectOptions(screen.getByLabelText(/filtru status/i), 'true');
    expect(replaceMock).toHaveBeenCalledWith('/products?isActive=true');
  });

  it('formats prices using ro-RO currency formatting', () => {
    render(
      <ProductsTable
        rows={baseRows}
        total={baseRows.length}
        page={1}
        pageSize={50}
        relevantOnly={false}
        search=""
        isActive=""
        marketplace=""
        listingStatus=""
        globalStats={defaultStats}
      />,
    );
    expect(screen.getAllByText(/RON/).length).toBeGreaterThan(0);
  });
});
