import { render, screen } from '@testing-library/react';
import { Box } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavLink } from './NavLink.js';

const usePathnameMock = vi.fn<() => string>();

vi.mock('next/navigation', () => ({
  usePathname: (): string => usePathnameMock(),
}));

afterEach(() => {
  usePathnameMock.mockReset();
});

describe('NavLink', () => {
  it('marks the link active when the pathname matches exactly', () => {
    usePathnameMock.mockReturnValue('/orders');
    render(
      <NavLink href="/orders" icon={Box}>
        Orders
      </NavLink>,
    );
    const link = screen.getByRole('link', { name: /orders/i });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.getAttribute('data-active')).toBe('true');
  });

  it('marks the link active when the pathname is a sub-route', () => {
    usePathnameMock.mockReturnValue('/orders/abc-123');
    render(
      <NavLink href="/orders" icon={Box}>
        Orders
      </NavLink>,
    );
    expect(screen.getByRole('link', { name: /orders/i }).getAttribute('data-active')).toBe('true');
  });

  it('does not mark the link active when the pathname differs', () => {
    usePathnameMock.mockReturnValue('/products');
    render(
      <NavLink href="/orders" icon={Box}>
        Orders
      </NavLink>,
    );
    const link = screen.getByRole('link', { name: /orders/i });
    expect(link.getAttribute('aria-current')).toBeNull();
    expect(link.getAttribute('data-active')).toBe('false');
  });

  it('renders external links as plain anchor with target=_blank', () => {
    usePathnameMock.mockReturnValue('/orders');
    render(
      <NavLink href="https://example.com/api-docs" icon={Box} external>
        API Docs
      </NavLink>,
    );
    const link = screen.getByRole('link', { name: /api docs/i });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
