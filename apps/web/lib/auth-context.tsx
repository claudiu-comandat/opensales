'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getMe, loginAction, logoutAction } from './auth-client.js';

import type { Me } from './auth-types.js';
import type { ReactElement, ReactNode } from 'react';

export interface AuthContextValue {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  initialUser?: Me | null;
}

export function AuthProvider({ children, initialUser = null }: AuthProviderProps): ReactElement {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(initialUser);
  const [loading, setLoading] = useState<boolean>(initialUser === null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const me = await getMe();
      setUser(me);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const res = await loginAction(email, password);
      setUser(res.user);
      router.refresh();
    },
    [router],
  );

  const logout = useCallback(async (): Promise<void> => {
    await logoutAction();
    setUser(null);
    router.push('/login');
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (initialUser === null) {
      void refresh();
    }
  }, [initialUser, refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function useUser(): Me | null {
  return useAuth().user;
}
