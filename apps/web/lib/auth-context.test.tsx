import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth, useUser } from './auth-context.js';

import type { Me } from './auth-types.js';
import type { ReactElement, ReactNode } from 'react';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const getMeMock = vi.fn();
const loginActionMock = vi.fn();
const logoutActionMock = vi.fn();

vi.mock('./auth-client.js', () => ({
  getMe: (...args: unknown[]): unknown => getMeMock(...args) as unknown,
  loginAction: (...args: unknown[]): unknown => loginActionMock(...args) as unknown,
  logoutAction: (...args: unknown[]): unknown => logoutActionMock(...args) as unknown,
}));

const adminUser: Me = { id: 'u1', email: 'a@b.c', role: 'admin' };

beforeEach(() => {
  getMeMock.mockReset();
  loginActionMock.mockReset();
  logoutActionMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function wrap(initialUser: Me | null = null): (p: { children: ReactNode }) => ReactElement {
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <AuthProvider initialUser={initialUser}>{children}</AuthProvider>;
  }
  return Wrapper;
}

describe('AuthProvider / useAuth', () => {
  it('uses initialUser without fetching', () => {
    getMeMock.mockResolvedValue(null);
    const { result } = renderHook(() => useAuth(), { wrapper: wrap(adminUser) });
    expect(result.current.user).toEqual(adminUser);
    expect(result.current.loading).toBe(false);
    expect(getMeMock).not.toHaveBeenCalled();
  });

  it('fetches /me when initialUser is null', async () => {
    getMeMock.mockResolvedValue(adminUser);
    const { result } = renderHook(() => useAuth(), { wrapper: wrap(null) });
    await waitFor(() => expect(result.current.user).toEqual(adminUser));
    expect(getMeMock).toHaveBeenCalledTimes(1);
  });

  it('login() sets user and refreshes router', async () => {
    getMeMock.mockResolvedValue(null);
    loginActionMock.mockResolvedValue({ user: adminUser });
    const { result } = renderHook(() => useAuth(), { wrapper: wrap(null) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.login('a@b.c', 'pw');
    });
    expect(loginActionMock).toHaveBeenCalledWith('a@b.c', 'pw');
    expect(result.current.user).toEqual(adminUser);
    expect(refreshMock).toHaveBeenCalled();
  });

  it('logout() clears user and pushes to /login', async () => {
    logoutActionMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth(), { wrapper: wrap(adminUser) });
    await act(async () => {
      await result.current.logout();
    });
    expect(logoutActionMock).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    expect(pushMock).toHaveBeenCalledWith('/login');
  });

  it('useAuth throws outside provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
  });

  it('useUser returns user from context', () => {
    function Probe(): ReactElement {
      const u = useUser();
      return <span data-testid="email">{u?.email ?? 'none'}</span>;
    }
    render(
      <AuthProvider initialUser={adminUser}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('email').textContent).toBe('a@b.c');
  });
});
