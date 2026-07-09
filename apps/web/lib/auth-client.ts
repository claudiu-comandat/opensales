import { getApiClient } from './api-client.js';

import type { Me } from './auth-types.js';

export async function loginAction(email: string, password: string): Promise<{ user: Me }> {
  return getApiClient().post<{ user: Me }>('/auth/login', { email, password });
}

export async function logoutAction(): Promise<void> {
  await getApiClient().post<void>('/auth/logout');
}

export async function getMe(): Promise<Me | null> {
  try {
    const res = await getApiClient().get<{ user: Me }>('/auth/me');
    return res.user;
  } catch {
    return null;
  }
}
