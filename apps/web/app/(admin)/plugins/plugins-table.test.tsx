import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginsTable, type Plugin } from './plugins-table.js';

const deleteMock = vi.fn();
const postMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  getApiClient: () => ({ post: postMock, delete: deleteMock }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const baseRow: Plugin = {
  id: 'plg_1',
  packageName: '@opensales-plugin/example',
  version: '1.0.0',
  displayName: 'Example',
  status: 'active',
  grantedPermissions: [],
};

describe('PluginsTable', () => {
  it('renders an empty state when no rows', () => {
    render(<PluginsTable rows={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent(/niciun plugin/i);
  });

  it('renders one row per plugin with status chip', () => {
    render(<PluginsTable rows={[baseRow, { ...baseRow, id: 'plg_2', status: 'disabled' }]} />);
    expect(screen.getByTestId('plugin-row-plg_1')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-row-plg_2')).toBeInTheDocument();
    expect(screen.getByTestId('status-active')).toBeInTheDocument();
    expect(screen.getByTestId('status-disabled')).toBeInTheDocument();
  });

  it('shows Activează when status is disabled and Dezactivează otherwise', () => {
    render(<PluginsTable rows={[baseRow, { ...baseRow, id: 'plg_2', status: 'disabled' }]} />);
    expect(screen.getByRole('button', { name: 'Dezactivează' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activează' })).toBeInTheDocument();
  });

  it('calls verify endpoint on Verifică click', async () => {
    postMock.mockResolvedValueOnce({ ok: true });
    // Stub reload to avoid jsdom errors
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: vi.fn() },
    });
    render(<PluginsTable rows={[baseRow]} />);
    await userEvent.click(screen.getByRole('button', { name: /verifică/i }));
    expect(postMock).toHaveBeenCalledWith('/plugins/plg_1/verify');
  });

  it('calls delete endpoint on Șterge click', async () => {
    deleteMock.mockResolvedValueOnce(undefined);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: vi.fn() },
    });
    render(<PluginsTable rows={[baseRow]} />);
    await userEvent.click(screen.getByRole('button', { name: /șterge/i }));
    expect(deleteMock).toHaveBeenCalledWith('/plugins/plg_1');
  });

  it('shows error alert when an action fails', async () => {
    postMock.mockRejectedValueOnce(new Error('boom'));
    render(<PluginsTable rows={[baseRow]} />);
    await userEvent.click(screen.getByRole('button', { name: /verifică/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/eșuat/i);
  });
});
