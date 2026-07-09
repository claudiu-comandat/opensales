import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecretsForm } from './secrets-form.js';

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

describe('SecretsForm', () => {
  it('shows placeholder when no secret fields are declared', () => {
    render(<SecretsForm pluginId="plg_1" fields={[]} />);
    expect(screen.getByText(/nu solicită secrete/i)).toBeInTheDocument();
  });

  it('renders password fields with type="password" and submits provided values', async () => {
    postMock.mockResolvedValueOnce(undefined);
    render(
      <SecretsForm
        pluginId="plg_1"
        fields={[{ name: 'apiKey', label: 'API Key', type: 'password', required: true }]}
      />,
    );

    const input = screen.getByLabelText(/api key/i);
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.type(input, 'sekret');
    await userEvent.click(screen.getByRole('button', { name: /salvează secrete/i }));

    expect(postMock).toHaveBeenCalledWith('/plugins/plg_1/configure', {
      secrets: { apiKey: 'sekret' },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('omits empty fields from the payload (allows partial update)', async () => {
    postMock.mockResolvedValueOnce(undefined);
    render(
      <SecretsForm
        pluginId="plg_1"
        fields={[
          { name: 'apiKey', label: 'API Key', type: 'password' },
          { name: 'apiSecret', label: 'API Secret', type: 'password' },
        ]}
      />,
    );
    await userEvent.type(screen.getByLabelText(/api key/i), 'only-key');
    await userEvent.click(screen.getByRole('button', { name: /salvează secrete/i }));

    expect(postMock).toHaveBeenCalledWith('/plugins/plg_1/configure', {
      secrets: { apiKey: 'only-key' },
    });
  });

  it('blocks submit when a required secret is missing', async () => {
    render(
      <SecretsForm
        pluginId="plg_1"
        fields={[{ name: 'apiKey', label: 'API Key', type: 'password', required: true }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /salvează secrete/i }));
    expect(postMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/obligatoriu/i);
  });
});
