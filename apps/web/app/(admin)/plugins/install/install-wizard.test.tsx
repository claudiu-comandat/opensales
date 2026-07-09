import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallWizard } from './install-wizard.js';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const postMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('@/lib/api-client', () => ({
  getApiClient: () => ({ post: postMock }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('InstallWizard', () => {
  it('renders the source step initially', () => {
    render(<InstallWizard />);
    expect(screen.getByLabelText(/pachet npm/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuă/i })).toBeDisabled();
  });

  it('switches input label when source kind changes', async () => {
    render(<InstallWizard />);
    await userEvent.click(screen.getByLabelText(/github/i));
    expect(screen.getByLabelText(/url repo github/i)).toBeInTheDocument();
  });

  it('progresses through source -> permissions when install succeeds', async () => {
    postMock.mockResolvedValueOnce({
      id: 'plg_42',
      manifest: { permissions: ['products:read', 'orders:write'] },
    });
    render(<InstallWizard />);
    await userEvent.type(screen.getByLabelText(/pachet npm/i), '@opensales-plugin/example');
    await userEvent.click(screen.getByRole('button', { name: /continuă/i }));
    expect(postMock).toHaveBeenCalledWith('/plugins/install-from-source', {
      source: '@opensales-plugin/example',
    });
    expect(await screen.findByText(/permisiuni cerute/i)).toBeInTheDocument();
    expect(screen.getByText('products:read')).toBeInTheDocument();
    expect(screen.getByText(/citește catalogul de produse/i)).toBeInTheDocument();
  });

  it('shows error when install fails', async () => {
    postMock.mockRejectedValueOnce(new Error('boom'));
    render(<InstallWizard />);
    await userEvent.type(screen.getByLabelText(/pachet npm/i), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: /continuă/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/instalarea a eșuat/i);
  });

  it('grants checked permissions and skips configure when no schema', async () => {
    postMock.mockResolvedValueOnce({
      id: 'plg_42',
      manifest: { permissions: ['products:read'] },
    });
    postMock.mockResolvedValueOnce(undefined);
    render(<InstallWizard />);
    await userEvent.type(screen.getByLabelText(/pachet npm/i), 'pkg');
    await userEvent.click(screen.getByRole('button', { name: /continuă/i }));

    await userEvent.click(await screen.findByLabelText(/products:read/i));
    await userEvent.click(screen.getByRole('button', { name: /continuă/i }));

    expect(postMock).toHaveBeenLastCalledWith('/plugins/plg_42/permissions', {
      permissions: ['products:read'],
    });
    expect(await screen.findByRole('heading', { name: /verificare/i })).toBeInTheDocument();
  });

  it('shows configure step when secretSchema is provided', async () => {
    postMock.mockResolvedValueOnce({
      id: 'plg_99',
      manifest: {
        permissions: [],
        secretSchema: {
          fields: [{ name: 'apiKey', label: 'API Key', type: 'password', required: true }],
        },
      },
    });
    postMock.mockResolvedValueOnce(undefined);
    render(<InstallWizard />);
    await userEvent.type(screen.getByLabelText(/pachet npm/i), 'pkg');
    await userEvent.click(screen.getByRole('button', { name: /continuă/i }));

    // Permissions step (no perms requested)
    await userEvent.click(await screen.findByRole('button', { name: /continuă/i }));

    // Configure step
    expect(await screen.findByRole('heading', { name: /configurare/i })).toBeInTheDocument();
    const apiKey = screen.getByLabelText(/api key/i);
    expect(apiKey).toHaveAttribute('type', 'password');
    await userEvent.type(apiKey, 'sekret');

    postMock.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole('button', { name: /continuă/i }));

    expect(postMock).toHaveBeenLastCalledWith('/plugins/plg_99/configure', {
      secrets: { apiKey: 'sekret' },
      config: undefined,
    });
  });

  it('shows verify result and redirects on success', async () => {
    postMock.mockResolvedValueOnce({ id: 'plg_v', manifest: { permissions: [] } });
    postMock.mockResolvedValueOnce(undefined);
    postMock.mockResolvedValueOnce({ ok: true });
    render(<InstallWizard />);
    await userEvent.type(screen.getByLabelText(/pachet npm/i), 'pkg');
    await userEvent.click(screen.getByRole('button', { name: /continuă/i }));
    await userEvent.click(await screen.findByRole('button', { name: /continuă/i }));
    await userEvent.click(await screen.findByRole('button', { name: /verifică/i }));
    expect(await screen.findByTestId('verify-result')).toHaveTextContent(/succes/i);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(pushMock).toHaveBeenCalledWith('/plugins');
  });
});
