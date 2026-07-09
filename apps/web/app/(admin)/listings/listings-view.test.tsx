import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ListingsView } from './listings-view.js';

import type { PluginGroup } from './page.js';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: (): { replace: typeof replaceMock; refresh: () => void } => ({
    replace: replaceMock,
    refresh: vi.fn(),
  }),
}));

const groups: PluginGroup[] = [
  {
    pluginId: 'plugin-a',
    rows: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        productId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        pluginId: 'plugin-a',
        externalListingId: 'EXT-ALPHA',
        status: 'active',
        lastSyncedAt: null,
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        productId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        pluginId: 'plugin-a',
        externalListingId: 'EXT-GAMMA',
        status: 'paused',
        lastSyncedAt: null,
      },
    ],
  },
  {
    pluginId: 'plugin-b',
    rows: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        productId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        pluginId: 'plugin-b',
        externalListingId: 'EXT-BETA',
        status: 'draft',
        lastSyncedAt: null,
      },
    ],
  },
];

afterEach(() => {
  replaceMock.mockReset();
});

describe('ListingsView', () => {
  it('renders one card per plugin', () => {
    render(<ListingsView groups={groups} initialPluginId="" initialStatus="" />);
    expect(screen.getAllByTestId('plugin-group')).toHaveLength(2);
    expect(screen.getByText('Plugin: plugin-a')).toBeTruthy();
    expect(screen.getByText('Plugin: plugin-b')).toBeTruthy();
  });

  it('filters rows client-side by external ID search', () => {
    render(<ListingsView groups={groups} initialPluginId="" initialStatus="" />);
    const search = screen.getByLabelText('External ID');
    fireEvent.change(search, { target: { value: 'beta' } });
    const visible = screen.getAllByTestId('plugin-group');
    expect(visible).toHaveLength(1);
    expect(visible[0]?.getAttribute('data-plugin-id')).toBe('plugin-b');
  });

  it('shows empty state when search matches nothing', () => {
    render(<ListingsView groups={groups} initialPluginId="" initialStatus="" />);
    fireEvent.change(screen.getByLabelText('External ID'), {
      target: { value: 'no-such-listing' },
    });
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('updates URL when applying plugin and status filters', () => {
    render(<ListingsView groups={groups} initialPluginId="" initialStatus="" />);
    fireEvent.change(screen.getByLabelText('Plugin'), { target: { value: 'plugin-a' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(replaceMock).toHaveBeenCalledWith('/listings?pluginId=plugin-a&status=active');
  });

  it('resets URL to /listings on reset', () => {
    render(<ListingsView groups={groups} initialPluginId="plugin-a" initialStatus="active" />);
    fireEvent.click(screen.getByText('Reset'));
    expect(replaceMock).toHaveBeenCalledWith('/listings');
  });
});
