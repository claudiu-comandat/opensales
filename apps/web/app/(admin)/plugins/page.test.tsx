import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PluginsPage', () => {
  it('renders the install button and the empty state when API returns no plugins', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ data: [] })),
      }),
    );
    const mod = await import('./page.js');
    const ui = await mod.default();
    render(ui);
    // The hero card shows the active plugin count followed by "pluginuri active".
    expect(screen.getByText(/pluginuri active/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /instalează plugin/i })).toHaveAttribute(
      'href',
      '/plugins/install',
    );
    expect(screen.getByRole('status')).toHaveTextContent(/niciun plugin/i);
  });

  it('renders rows for each plugin returned by the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              data: [
                {
                  id: 'plg_a',
                  packageName: '@opensales-plugin/a',
                  version: '1.0.0',
                  status: 'active',
                },
              ],
            }),
          ),
      }),
    );
    const mod = await import('./page.js');
    const ui = await mod.default();
    render(ui);
    expect(screen.getByTestId('plugin-row-plg_a')).toBeInTheDocument();
  });

  it('falls back to empty list when API call throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const mod = await import('./page.js');
    const ui = await mod.default();
    render(ui);
    expect(screen.getByRole('status')).toHaveTextContent(/niciun plugin/i);
  });
});
