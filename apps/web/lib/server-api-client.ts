import { cookies } from 'next/headers';

import { ApiClient } from './api-client.js';

/**
 * Server-side API client that forwards the current request's cookies to the
 * upstream API. Use this in React Server Components and Route Handlers instead
 * of getApiClient(), which doesn't carry session credentials server-to-server.
 */
export async function getServerApiClient(): Promise<ApiClient> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    throw new Error(
      'API_URL is required server-side. Set it on the web service, ' +
        'e.g. on Railway: API_URL=http://${{ @opensales/api.RAILWAY_PRIVATE_DOMAIN }}:3001',
    );
  }

  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const fetchWithCookies: typeof fetch = (url, init) => {
    const headers = new Headers(init?.headers);
    if (cookieHeader) headers.set('Cookie', cookieHeader);
    return fetch(url, { ...init, headers });
  };

  return new ApiClient({
    baseUrl: apiUrl.replace(/\/$/, ''),
    fetchFn: fetchWithCookies,
  });
}
