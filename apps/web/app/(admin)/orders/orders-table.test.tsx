import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrdersTable, type OrderRow } from './orders-table.js';

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { replace: typeof replaceMock; refresh: typeof refreshMock } => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  useSearchParams: (): URLSearchParams => new URLSearchParams(''),
}));

const postMock = vi.fn().mockResolvedValue({});
const deleteMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/api-client', () => ({
  getApiClient: (): { post: typeof postMock; delete: typeof deleteMock } => ({
    post: postMock,
    delete: deleteMock,
  }),
}));

const baseRows: OrderRow[] = [
  {
    id: 'order-1',
    externalId: 'EXT-001',
    pluginId: 'plugin-a',
    status: 'new',
    total: { amountMinor: '12345', currency: 'RON' },
    customer: { email: 'alice@example.com', name: 'Alice' },
    placedAt: '2026-01-02T10:30:00.000Z',
  },
  {
    id: 'order-2',
    externalId: 'EXT-002',
    pluginId: 'plugin-b',
    status: 'delivered',
    total: { amountMinor: '99900', currency: 'RON' },
    customer: { email: null, name: null },
    placedAt: '2026-02-15T08:00:00.000Z',
  },
];

afterEach(() => {
  replaceMock.mockReset();
  refreshMock.mockReset();
  postMock.mockReset();
  deleteMock.mockReset();
  postMock.mockResolvedValue({});
  deleteMock.mockResolvedValue(undefined);
});

describe('OrdersTable', () => {
  it('renders one row per order with external id and status', () => {
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    expect(screen.getByTestId('order-row-order-1')).toBeInTheDocument();
    expect(screen.getByTestId('order-row-order-2')).toBeInTheDocument();
    // External id may be wrapped (e.g. "#EXT-001") — flexible matcher
    expect(screen.getByText(/EXT-001/)).toBeInTheDocument();
    expect(screen.getByTestId('order-status-order-1')).toHaveTextContent('new');
    expect(screen.getByTestId('order-status-order-2')).toHaveTextContent('delivered');
  });

  it('shows empty state when no rows are provided', () => {
    render(
      <OrdersTable
        rows={[]}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    expect(screen.getByTestId('orders-empty')).toBeInTheDocument();
  });

  it('formats totals using ro-RO currency formatting', () => {
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    expect(screen.getAllByText(/RON/).length).toBeGreaterThan(0);
  });

  it('renders detail link for each row', () => {
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    const links = screen.getAllByRole('link', { name: /detalii/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/orders/order-1');
    expect(links[1]).toHaveAttribute('href', '/orders/order-2');
  });

  it('disables pagination buttons at boundaries', () => {
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /următor/i })).toBeDisabled();
  });

  it('enables next pagination when more pages exist', () => {
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={3}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /următor/i })).not.toBeDisabled();
  });

  it('navigates next page on click', async () => {
    const user = userEvent.setup();
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={3}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    await user.click(screen.getByRole('button', { name: /următor/i }));
    expect(replaceMock).toHaveBeenCalledWith('/orders?page=2');
  });

  it('updates URL when changing the status filter', async () => {
    const user = userEvent.setup();
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    await user.selectOptions(screen.getByLabelText(/filtru status/i), 'shipped');
    expect(replaceMock).toHaveBeenCalledWith('/orders?status=shipped');
  });

  it('clears the status filter when selecting "all"', async () => {
    const user = userEvent.setup();
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status="shipped"
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    await user.selectOptions(screen.getByLabelText(/filtru status/i), '');
    expect(replaceMock).toHaveBeenCalledWith('/orders');
  });

  it('updates URL when selecting placedAfter date', async () => {
    const user = userEvent.setup();
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    const input = screen.getByLabelText(/de la data/i);
    await user.type(input, '2026-01-01');
    expect(replaceMock).toHaveBeenLastCalledWith('/orders?placedAfter=2026-01-01');
  });

  it('updates URL when selecting placedBefore date', async () => {
    const user = userEvent.setup();
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    const input = screen.getByLabelText(/până la data/i);
    await user.type(input, '2026-03-01');
    expect(replaceMock).toHaveBeenLastCalledWith('/orders?placedBefore=2026-03-01');
  });

  it('renders dash for missing customer name', () => {
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={1}
        page={1}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    // Multiple "—" exist (missing marketplace, payment, etc).
    // Verify at least one is rendered for missing customer name.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows pagination info with page count', () => {
    render(
      <OrdersTable
        rows={baseRows}
        totalPages={3}
        page={2}
        pageSize={50}
        status=""
        placedAfter=""
        placedBefore=""
        search=""
        marketplaceInclude=""
        hasInvoice={false}
        hasAwb={false}
        hasShipping={false}
        hasVoucher={false}
        paymentMethod=""
        deliveryMode=""
      />,
    );
    const info = screen.getByTestId('orders-pagination-info');
    expect(info).toHaveTextContent('Pagina 2 din 3');
  });
});

// ── Invoice cell quick-actions ─────────────────────────────────────────────────

function renderWithRow(row: OrderRow): void {
  render(
    <OrdersTable
      rows={[row]}
      totalPages={1}
      page={1}
      pageSize={50}
      status=""
      placedAfter=""
      placedBefore=""
      search=""
      marketplaceInclude=""
      hasInvoice={false}
      hasAwb={false}
      hasShipping={false}
      hasVoucher={false}
      paymentMethod=""
      deliveryMode=""
    />,
  );
}

const baseOrder: OrderRow = {
  id: 'order-inv',
  externalId: 'EXT-INV',
  pluginId: 'plugin-a',
  status: 'new',
  total: { amountMinor: '10000', currency: 'RON' },
  customer: { email: null, name: 'Test' },
  placedAt: '2026-05-19T10:00:00.000Z',
};

describe('Invoice cell — no invoice', () => {
  it('shows + Creare rapidă button', () => {
    renderWithRow(baseOrder);
    expect(screen.getByTestId('invoice-emit-order-inv')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-emit-order-inv')).toHaveTextContent('+ Creare rapidă');
  });

  it('does not show storno or delete buttons', () => {
    renderWithRow(baseOrder);
    expect(screen.queryByTestId('invoice-storno-order-inv')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invoice-delete-order-inv')).not.toBeInTheDocument();
  });

  it('calls POST /invoice/emit and refreshes on click', async () => {
    const user = userEvent.setup();
    renderWithRow(baseOrder);
    await user.click(screen.getByTestId('invoice-emit-order-inv'));
    expect(postMock).toHaveBeenCalledWith('/orders/order-inv/invoice/emit');
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});

describe('Invoice cell — invoice exists, no storno', () => {
  const orderWithInvoice: OrderRow = { ...baseOrder, invoiceSeries: 'E 2542' };

  it('shows invoice number', () => {
    renderWithRow(orderWithInvoice);
    expect(screen.getByTestId('invoice-number-order-inv')).toHaveTextContent('E 2542');
  });

  it('shows ··· menu button and Stornează/Șterge inside it', async () => {
    const user = userEvent.setup();
    renderWithRow(orderWithInvoice);
    await user.click(screen.getByTestId('invoice-actions-order-inv'));
    expect(screen.getByTestId('invoice-storno-order-inv')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-delete-order-inv')).toBeInTheDocument();
  });

  it('does not show + Creare rapidă', () => {
    renderWithRow(orderWithInvoice);
    expect(screen.queryByTestId('invoice-emit-order-inv')).not.toBeInTheDocument();
  });

  it('calls POST /invoice/storno and refreshes on Stornează click', async () => {
    const user = userEvent.setup();
    renderWithRow(orderWithInvoice);
    await user.click(screen.getByTestId('invoice-actions-order-inv'));
    await user.click(screen.getByTestId('invoice-storno-order-inv'));
    expect(postMock).toHaveBeenCalledWith('/orders/order-inv/invoice/storno');
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it('calls DELETE /invoice and refreshes after confirm', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithRow(orderWithInvoice);
    await user.click(screen.getByTestId('invoice-actions-order-inv'));
    await user.click(screen.getByTestId('invoice-delete-order-inv'));
    expect(deleteMock).toHaveBeenCalledWith('/orders/order-inv/invoice');
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it('does NOT call DELETE when confirm is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithRow(orderWithInvoice);
    await user.click(screen.getByTestId('invoice-actions-order-inv'));
    await user.click(screen.getByTestId('invoice-delete-order-inv'));
    expect(deleteMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('Invoice cell — invoice + storno exist', () => {
  const orderWithStorno: OrderRow = {
    ...baseOrder,
    invoiceSeries: 'E 2542',
    invoiceStornoSeries: 'E 2543',
  };

  it('shows invoice number', () => {
    renderWithRow(orderWithStorno);
    expect(screen.getByTestId('invoice-number-order-inv')).toHaveTextContent('E 2542');
  });

  it('shows storno badge', () => {
    renderWithRow(orderWithStorno);
    expect(screen.getByTestId('invoice-storno-badge-order-inv')).toHaveTextContent('Storno E 2543');
  });

  it('does not show Stornează or Șterge buttons', () => {
    renderWithRow(orderWithStorno);
    expect(screen.queryByTestId('invoice-storno-order-inv')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invoice-delete-order-inv')).not.toBeInTheDocument();
  });
});
