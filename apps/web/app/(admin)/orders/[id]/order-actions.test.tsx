import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderActions } from './order-actions.js';

const refreshMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { refresh: typeof refreshMock } => ({ refresh: refreshMock }),
}));

vi.mock('@/lib/api-client', () => ({
  getApiClient: (): { put: typeof putMock; delete: typeof deleteMock } => ({
    put: putMock,
    delete: deleteMock,
  }),
}));

beforeEach(() => {
  refreshMock.mockReset();
  putMock.mockReset().mockResolvedValue(undefined);
  deleteMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const filledAwb = {
  number: 'AWB-123',
  tracking: 'TRK-9',
  carrierPluginId: '00000000-0000-0000-0000-000000000001',
  pdfUrl: 'https://example.com/awb.pdf',
  status: 'issued',
  issuedAt: '2026-04-01T08:00:00.000Z',
};

const filledInvoice = {
  series: 'INV',
  number: '00045',
  pdfUrl: 'https://example.com/invoice.pdf',
  status: 'issued',
  issuedAt: '2026-04-01T08:00:00.000Z',
};

describe('OrderActions', () => {
  it('renders four blocks: AWB tur/retur and Invoice/Storno', () => {
    render(
      <OrderActions
        orderId="order-1"
        awbOutgoing={null}
        awbReturn={null}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    expect(screen.getByTestId('awb-outgoing')).toBeInTheDocument();
    expect(screen.getByTestId('awb-return')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-invoice')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-storno')).toBeInTheDocument();
  });

  it('shows "Adaugă" when AWB is missing and "Modifică" when present', () => {
    render(
      <OrderActions
        orderId="order-1"
        awbOutgoing={null}
        awbReturn={filledAwb}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    expect(screen.getByTestId('awb-outgoing-edit')).toHaveTextContent('Adaugă');
    expect(screen.getByTestId('awb-return-edit')).toHaveTextContent('Modifică');
    expect(screen.getByTestId('awb-return-clear')).toBeInTheDocument();
    expect(screen.queryByTestId('awb-outgoing-clear')).not.toBeInTheDocument();
  });

  it('renders AWB PDF link when pdfUrl is set', () => {
    render(
      <OrderActions
        orderId="order-1"
        awbOutgoing={filledAwb}
        awbReturn={null}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    const link = screen.getByTestId('awb-outgoing-pdf');
    expect(link).toHaveAttribute('href', 'https://example.com/awb.pdf');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders invoice PDF link when pdfUrl is set', () => {
    render(
      <OrderActions
        orderId="order-1"
        awbOutgoing={null}
        awbReturn={null}
        invoice={filledInvoice}
        invoiceStorno={null}
      />,
    );
    const link = screen.getByTestId('invoice-invoice-pdf');
    expect(link).toHaveAttribute('href', 'https://example.com/invoice.pdf');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('clears AWB outgoing through DELETE on the right path', async () => {
    const user = userEvent.setup();
    render(
      <OrderActions
        orderId="order-9"
        awbOutgoing={filledAwb}
        awbReturn={null}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    await user.click(screen.getByTestId('awb-outgoing-clear'));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith('/orders/order-9/awb-outgoing');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('clears AWB return through DELETE on the right path', async () => {
    const user = userEvent.setup();
    render(
      <OrderActions
        orderId="order-9"
        awbOutgoing={null}
        awbReturn={filledAwb}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    await user.click(screen.getByTestId('awb-return-clear'));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith('/orders/order-9/awb-return');
  });

  it('clears invoice and invoice storno through DELETE on the right paths', async () => {
    const user = userEvent.setup();
    render(
      <OrderActions
        orderId="order-7"
        awbOutgoing={null}
        awbReturn={null}
        invoice={filledInvoice}
        invoiceStorno={filledInvoice}
      />,
    );
    await user.click(screen.getByTestId('invoice-invoice-clear'));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/orders/order-7/invoice'));
    await user.click(screen.getByTestId('invoice-storno-clear'));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/orders/order-7/invoice-storno'));
  });

  it('opens the AWB form and submits with PUT', async () => {
    const user = userEvent.setup();
    render(
      <OrderActions
        orderId="order-2"
        awbOutgoing={null}
        awbReturn={null}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    await user.click(screen.getByTestId('awb-outgoing-edit'));
    await user.type(screen.getByLabelText(/^număr$/i), 'AWB-555');
    await user.type(
      screen.getByLabelText(/carrier plugin id/i),
      '00000000-0000-0000-0000-000000000001',
    );
    await user.click(screen.getByRole('button', { name: /^salvează$/i }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const [url, body] = putMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/orders/order-2/awb-outgoing');
    expect(body.number).toBe('AWB-555');
    expect(body.carrierPluginId).toBe('00000000-0000-0000-0000-000000000001');
    expect(body.status).toBe('pending');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('opens the invoice form and submits with PUT', async () => {
    const user = userEvent.setup();
    render(
      <OrderActions
        orderId="order-3"
        awbOutgoing={null}
        awbReturn={null}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    await user.click(screen.getByTestId('invoice-invoice-edit'));
    await user.type(screen.getByLabelText(/^serie$/i), 'INV');
    await user.type(screen.getByLabelText(/^număr$/i), '00099');
    await user.click(screen.getByRole('button', { name: /^salvează$/i }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const [url, body] = putMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/orders/order-3/invoice');
    expect(body.series).toBe('INV');
    expect(body.number).toBe('00099');
    expect(body.status).toBe('draft');
  });

  it('shows "Nu e setat." for empty AWB and "Nu e setată." for empty invoice', () => {
    render(
      <OrderActions
        orderId="order-1"
        awbOutgoing={null}
        awbReturn={null}
        invoice={null}
        invoiceStorno={null}
      />,
    );
    expect(screen.getAllByText(/Nu e setat\.$/).length).toBe(2);
    expect(screen.getAllByText(/Nu e setată\.$/).length).toBe(2);
  });
});
