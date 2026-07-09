import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TopBar, buildBreadcrumbs } from './TopBar.js';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { push: typeof pushMock; refresh: typeof refreshMock } => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  usePathname: (): string => '/orders/123',
}));

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      text: () => Promise.resolve(''),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildBreadcrumbs', () => {
  it('returns Home for the root path', () => {
    expect(buildBreadcrumbs('/')).toEqual([{ label: 'Home', href: '/' }]);
  });

  it('builds nested crumbs', () => {
    expect(buildBreadcrumbs('/orders/abc')).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Orders', href: '/orders' },
      { label: 'Abc', href: '/orders/abc' },
    ]);
  });
});

describe('TopBar', () => {
  it('renders the user email when provided', () => {
    render(<TopBar user={{ email: 'admin@example.com' }} />);
    expect(screen.getByTestId('user-menu-trigger').textContent).toContain('admin@example.com');
  });

  it('renders an "Account" placeholder when no user', () => {
    render(<TopBar />);
    expect(screen.getByTestId('user-menu-trigger').textContent).toContain('Account');
  });

  it('opens the user menu when the trigger is clicked', () => {
    render(<TopBar user={{ email: 'admin@example.com' }} />);
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('logs out and navigates to /login on logout click', async () => {
    render(<TopBar user={{ email: 'admin@example.com' }} />);
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    fireEvent.click(screen.getByTestId('logout-button'));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/login');
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('renders breadcrumbs derived from the pathname', () => {
    render(<TopBar />);
    const nav = screen.getByLabelText('Breadcrumb');
    expect(nav.textContent).toContain('Home');
    expect(nav.textContent).toContain('Orders');
    expect(nav.textContent).toContain('123');
  });
});
