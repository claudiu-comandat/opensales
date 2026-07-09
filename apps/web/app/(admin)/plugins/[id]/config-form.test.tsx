import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigForm } from './config-form.js';

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

describe('ConfigForm', () => {
  it('shows a placeholder when there are no fields', () => {
    render(<ConfigForm pluginId="plg_1" fields={[]} />);
    expect(screen.getByText(/nu expune câmpuri/i)).toBeInTheDocument();
  });

  it('hydrates initial values and submits typed config payload', async () => {
    postMock.mockResolvedValueOnce(undefined);
    render(
      <ConfigForm
        pluginId="plg_1"
        fields={[
          { name: 'baseUrl', label: 'Base URL', type: 'string', required: true },
          { name: 'timeoutMs', label: 'Timeout', type: 'number' },
        ]}
        initialValues={{ baseUrl: 'https://api.example', timeoutMs: 5000 }}
      />,
    );
    expect(screen.getByLabelText(/base url/i)).toHaveValue('https://api.example');
    expect(screen.getByLabelText(/timeout/i)).toHaveValue(5000);

    await userEvent.click(screen.getByRole('button', { name: /salvează configurație/i }));

    expect(postMock).toHaveBeenCalledWith('/plugins/plg_1/configure', {
      config: { baseUrl: 'https://api.example', timeoutMs: 5000 },
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('blocks submit when a required field is empty', () => {
    render(
      <ConfigForm
        pluginId="plg_1"
        fields={[{ name: 'baseUrl', label: 'Base URL', type: 'string', required: true }]}
      />,
    );
    const form = screen.getByTestId('config-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(postMock).not.toHaveBeenCalled();
  });
});
