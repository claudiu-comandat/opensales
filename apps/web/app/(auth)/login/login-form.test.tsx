import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LoginForm from './login-form.js';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(''),
}));

const postMock = vi.fn();
vi.mock('@/lib/api-client', () => ({
  getApiClient: () => ({ post: postMock }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('LoginForm', () => {
  it('shows validation errors when empty', async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole('button', { name: /autentificare/i }));
    expect(await screen.findByText(/email invalid/i)).toBeInTheDocument();
  });

  it('calls API on submit with valid input', async () => {
    postMock.mockResolvedValueOnce({
      user: { id: '1', email: 'admin@example.com', role: 'admin' },
    });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await userEvent.type(screen.getByLabelText(/parolă/i), 'longpassword');
    await userEvent.click(screen.getByRole('button', { name: /autentificare/i }));
    expect(postMock).toHaveBeenCalledWith('/auth/login', {
      email: 'admin@example.com',
      password: 'longpassword',
    });
    expect(pushMock).toHaveBeenCalledWith('/');
  });

  it('shows error on 401', async () => {
    const { ApiError } = await import('@/lib/api-types');
    postMock.mockRejectedValueOnce(
      new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await userEvent.type(screen.getByLabelText(/parolă/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /autentificare/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorecte/i);
  });

  it('shows generic error on non-401 failure', async () => {
    const { ApiError } = await import('@/lib/api-types');
    postMock.mockRejectedValueOnce(
      new ApiError(500, { error: { code: 'INTERNAL', message: 'boom' } }),
    );
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await userEvent.type(screen.getByLabelText(/parolă/i), 'longpassword');
    await userEvent.click(screen.getByRole('button', { name: /autentificare/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Eroare la autentificare/i);
  });
});
