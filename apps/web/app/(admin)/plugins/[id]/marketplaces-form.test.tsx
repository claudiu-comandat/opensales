import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketplacesForm } from './marketplaces-form.js';

import { supportedMarketplacesForPackage } from '@/lib/marketplace-catalog';

const refreshMock = vi.fn();
const postMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock('@/lib/api-client', () => ({
  getApiClient: () => ({ post: postMock }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const emagMarketplaces = supportedMarketplacesForPackage('@opensales-plugin/emag');

describe('MarketplacesForm', () => {
  it('hydrates enabled marketplaces from initial state', () => {
    render(
      <MarketplacesForm
        pluginId="plg_1"
        supported={emagMarketplaces}
        initialEnabled={['emag-ro']}
      />,
    );
    expect(screen.getByLabelText(/eMAG Romania/i)).toBeChecked();
    expect(screen.getByLabelText(/eMAG Bulgaria/i)).not.toBeChecked();
  });

  it('saves the selected marketplaces as config.enabledMarketplaces', async () => {
    postMock.mockResolvedValueOnce(undefined);
    render(
      <MarketplacesForm
        pluginId="plg_1"
        supported={emagMarketplaces}
        initialEnabled={['emag-ro']}
      />,
    );

    await userEvent.click(screen.getByLabelText(/eMAG Hungary/i));
    await userEvent.click(screen.getByRole('button', { name: /salvează marketplace-uri/i }));

    expect(postMock).toHaveBeenCalledWith('/plugins/plg_1/configure', {
      config: { enabledMarketplaces: ['emag-ro', 'emag-hu'] },
    });
    expect(refreshMock).toHaveBeenCalled();
  });
});
