import { NextResponse } from 'next/server';

// Diagnostic endpoint — shows what the web server sees for API_URL at runtime
// and whether it can reach the API. Safe to expose: API_URL is the API's
// public Railway domain (already public knowledge in CORS, browser logs, etc.).
// Delete this file once Railway deployment is debugged.
export async function GET(): Promise<NextResponse> {
  const apiUrl = process.env.API_URL ?? null;
  const result: Record<string, unknown> = {
    nodeEnv: process.env.NODE_ENV ?? null,
    apiUrlSet: apiUrl !== null,
    apiUrlValue: apiUrl,
    reachable: null,
    reachError: null,
  };

  if (apiUrl) {
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/healthz`, {
        cache: 'no-store',
      });
      result.reachable = res.status;
    } catch (e) {
      result.reachError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(result);
}
