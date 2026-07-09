'use client';

const CSRF_COOKIE = 'csrf_token';

export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  if (!match) return null;
  const value = match.split('=')[1];
  return value !== undefined ? decodeURIComponent(value) : null;
}
