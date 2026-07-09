import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PLUGIN_FIXTURE = {
  id: 'plg_1',
  packageName: '@opensales-plugin/example',
  version: '1.2.3',
  displayName: 'Example Plugin',
  status: 'active',
  manifest: {
    type: 'integration',
    description: 'Demo plugin',
    permissions: ['products:read'],
    secretSchema: { fields: [{ name: 'apiKey', label: 'API Key', type: 'password' }] },
    configSchema: { fields: [{ name: 'baseUrl', label: 'Base URL', type: 'string' }] },
  },
  config: { baseUrl: 'https://api.example' },
  grantedPermissions: ['products:read'],
  lastError: null,
  lastHealthCheckAt: null,
  installedAt: '2025-01-01T00:00:00Z',
};

describe('PluginDetailPage', () => {
  it('renders plugin header, status, permissions, config and secrets sections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify(PLUGIN_FIXTURE)),
      }),
    );
    const mod = await import('./page.js');
    const ui = await mod.default({ params: Promise.resolve({ id: 'plg_1' }) });
    render(ui);

    expect(screen.getByRole('heading', { name: /example plugin/i })).toBeInTheDocument();
    expect(screen.getByText(/@opensales-plugin\/example@1.2.3/)).toBeInTheDocument();
    expect(screen.getByTestId('plugin-status')).toHaveTextContent('active');
    expect(screen.getByRole('heading', { name: /permisiuni/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /configurație/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /secrete/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/base url/i)).toHaveValue('https://api.example');
    expect(screen.getByLabelText(/api key/i)).toHaveAttribute('type', 'password');
  });

  it('calls notFound when API returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Plugin not found' } }),
          ),
      }),
    );
    const mod = await import('./page.js');
    await expect(mod.default({ params: Promise.resolve({ id: 'plg_missing' }) })).rejects.toThrow(
      /NEXT_NOT_FOUND/,
    );
  });

  it('renders empty-state messages when manifest exposes no schema or permissions', async () => {
    const sparse = {
      ...PLUGIN_FIXTURE,
      manifest: { type: 'integration', description: 'No schema' },
      grantedPermissions: [],
      config: {},
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify(sparse)),
      }),
    );
    const mod = await import('./page.js');
    const ui = await mod.default({ params: Promise.resolve({ id: 'plg_1' }) });
    render(ui);

    expect(screen.getByText(/nu cere permisiuni/i)).toBeInTheDocument();
    expect(screen.getByText(/nu expune câmpuri/i)).toBeInTheDocument();
    expect(screen.getByText(/nu solicită secrete/i)).toBeInTheDocument();
  });
});
