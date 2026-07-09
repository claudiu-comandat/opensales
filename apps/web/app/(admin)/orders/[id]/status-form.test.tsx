import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STATUS_TRANSITIONS,
  StatusForm,
  getValidTransitions,
  type OrderStatus,
} from './status-form.js';

const refreshMock = vi.fn();
const patchMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { refresh: typeof refreshMock } => ({ refresh: refreshMock }),
}));

vi.mock('@/lib/api-client', () => ({
  getApiClient: (): { patch: typeof patchMock } => ({ patch: patchMock }),
}));

beforeEach(() => {
  refreshMock.mockReset();
  patchMock.mockReset();
  patchMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('STATUS_TRANSITIONS', () => {
  it('matches the backend state machine exactly', () => {
    const expected: Record<OrderStatus, OrderStatus[]> = {
      new: ['processing', 'cancelled'],
      processing: ['packed', 'cancelled'],
      packed: ['shipped', 'cancelled'],
      shipped: ['delivered', 'returned'],
      delivered: ['returned'],
      returned: ['refunded'],
      cancelled: [],
      refunded: [],
    };
    expect(STATUS_TRANSITIONS).toEqual(expected);
  });

  it('returns empty array for unknown status', () => {
    expect(getValidTransitions('unknown-status')).toEqual([]);
  });

  it('returns valid transitions for a known status', () => {
    expect(getValidTransitions('new')).toEqual(['processing', 'cancelled']);
  });
});

describe('StatusForm', () => {
  it('shows "status final" when no transitions exist', () => {
    render(<StatusForm orderId="order-1" currentStatus="cancelled" />);
    expect(screen.getByTestId('status-final')).toBeInTheDocument();
    expect(screen.queryByTestId('status-form')).not.toBeInTheDocument();
  });

  it('renders only valid transitions in the dropdown', () => {
    render(<StatusForm orderId="order-1" currentStatus="new" />);
    const select = screen.getByLabelText(/status nou/i);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['processing', 'cancelled']);
  });

  it('does not include the same status twice for shipped', () => {
    render(<StatusForm orderId="order-1" currentStatus="shipped" />);
    const select = screen.getByLabelText(/status nou/i);
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['delivered', 'returned']);
    expect(options).not.toContain('shipped');
  });

  it('submits the chosen status and refreshes the router', async () => {
    const user = userEvent.setup();
    render(<StatusForm orderId="order-42" currentStatus="new" />);
    await user.selectOptions(screen.getByLabelText(/status nou/i), 'cancelled');
    await user.click(screen.getByRole('button', { name: /schimbă status/i }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith('/orders/order-42/status', { status: 'cancelled' });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('renders an error when the API call fails', async () => {
    const user = userEvent.setup();
    patchMock.mockRejectedValueOnce(new Error('boom'));
    render(<StatusForm orderId="order-1" currentStatus="new" />);
    await user.click(screen.getByRole('button', { name: /schimbă status/i }));
    await waitFor(() =>
      expect(screen.getByTestId('status-error')).toHaveTextContent(/eroare|boom/i),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
