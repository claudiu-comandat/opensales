import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PermissionsForm } from './permissions-form.js';

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

describe('PermissionsForm', () => {
  it('renders message when no permissions are declared', () => {
    render(<PermissionsForm pluginId="plg_1" declaredPermissions={[]} grantedPermissions={[]} />);
    expect(screen.getByText(/nu cere permisiuni/i)).toBeInTheDocument();
  });

  it('renders declared permissions with descriptions and pre-checks granted ones', () => {
    render(
      <PermissionsForm
        pluginId="plg_1"
        declaredPermissions={['products:read', 'orders:write']}
        grantedPermissions={['products:read']}
      />,
    );
    const productsBox = screen.getByLabelText(/products:read/i);
    const ordersBox = screen.getByLabelText(/orders:write/i);
    expect(productsBox).toBeChecked();
    expect(ordersBox).not.toBeChecked();
    expect(screen.getByText(/citește catalogul de produse/i)).toBeInTheDocument();
  });

  it('toggles a permission and saves the new set', async () => {
    postMock.mockResolvedValueOnce(undefined);
    render(
      <PermissionsForm
        pluginId="plg_1"
        declaredPermissions={['products:read', 'orders:write']}
        grantedPermissions={['products:read']}
      />,
    );
    await userEvent.click(screen.getByLabelText(/orders:write/i));
    await userEvent.click(screen.getByRole('button', { name: /salvează permisiuni/i }));

    expect(postMock).toHaveBeenCalledWith('/plugins/plg_1/permissions', {
      permissions: ['products:read', 'orders:write'],
    });
    expect(await screen.findByText(/permisiuni salvate/i)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows an error message when the API rejects', async () => {
    postMock.mockRejectedValueOnce(new Error('boom'));
    render(
      <PermissionsForm
        pluginId="plg_1"
        declaredPermissions={['products:read']}
        grantedPermissions={[]}
      />,
    );
    await userEvent.click(screen.getByLabelText(/products:read/i));
    await userEvent.click(screen.getByRole('button', { name: /salvează permisiuni/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/eroare/i);
  });
});
