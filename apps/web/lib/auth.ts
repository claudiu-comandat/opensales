import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Me, Role } from './auth-types.js';

// Server-side only — reads API_URL at runtime (not baked at build time).
function getApiUrl(): string {
  const url = process.env.API_URL;
  if (!url) {
    throw new Error(
      'API_URL is required. Set it on the web service, ' +
        'e.g. on Railway: API_URL=https://${{ @opensales/api.RAILWAY_PUBLIC_DOMAIN }}',
    );
  }
  return url.replace(/\/$/, '');
}

export async function fetchMe(): Promise<Me | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
  try {
    const res = await fetch(`${getApiUrl()}/auth/me`, {
      headers: { cookie: cookieHeader, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { user: Me };
    return json.user;
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<Me> {
  const me = await fetchMe();
  if (!me) redirect('/login');
  return me;
}

export async function requireRole(role: Role): Promise<Me> {
  const me = await requireAuth();
  if (me.role !== role && me.role !== 'admin') {
    redirect('/');
  }
  return me;
}
