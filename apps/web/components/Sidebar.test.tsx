import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from './Sidebar.js';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: (): string => '/products',
  useRouter: (): { push: typeof pushMock; refresh: typeof refreshMock } => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Sidebar', () => {
  it('renders the brand name', () => {
    render(<Sidebar />);
    // "OpenSales" may also appear as the default organization label in the
    // footer when no user is supplied — confirm at least one rendering.
    expect(screen.getAllByText('OpenSales').length).toBeGreaterThan(0);
  });

  it('renders all expected navigation items', () => {
    render(<Sidebar />);
    for (const label of ['Comenzi', 'Produse', 'Plugins', 'Setări', 'API Docs']) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });

  it('exposes a primary navigation landmark', () => {
    render(<Sidebar />);
    expect(screen.getByLabelText('Primary navigation')).toBeInTheDocument();
  });

  it('marks the active route based on pathname', () => {
    render(<Sidebar />);
    const productsLink = screen.getByRole('link', { name: /produse/i });
    expect(productsLink.getAttribute('aria-current')).toBe('page');
  });

  it('renders a logout button at the bottom', () => {
    render(<Sidebar user={{ email: 'admin@example.com' }} />);
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });
});
