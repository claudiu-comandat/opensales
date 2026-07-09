import { NextResponse, type NextRequest } from 'next/server';

// Force runtime evaluation — never cache, always read API_URL fresh.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Hop-by-hop headers per RFC 7230 §6.1 — must NOT be forwarded by a proxy.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length', // recomputed by fetch
]);

function copyHeaders(src: Headers): Headers {
  const dst = new Headers();
  src.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    // Set-Cookie is special: there can be multiple values and they MUST be
    // sent as separate headers, not joined with ", ". Headers.forEach joins
    // them — handle separately below via getSetCookie().
    if (lower === 'set-cookie') return;
    dst.set(key, value);
  });
  // Forward each Set-Cookie individually so the browser parses them correctly.
  const setCookies = src.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    dst.append('set-cookie', cookie);
  }
  return dst;
}

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return NextResponse.json(
      {
        error: {
          code: 'API_URL_NOT_SET',
          message:
            'API_URL is not configured on the web service. Set it to the API public URL, ' +
            'e.g. on Railway: API_URL=https://${{ @opensales/api.RAILWAY_PUBLIC_DOMAIN }}',
        },
      },
      { status: 500 },
    );
  }

  const { path } = await ctx.params;
  const target = `${apiUrl.replace(/\/$/, '')}/${path.join('/')}${req.nextUrl.search}`;

  const init: RequestInit = {
    method: req.method,
    headers: copyHeaders(req.headers),
    redirect: 'manual',
    cache: 'no-store',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    return NextResponse.json(
      {
        error: {
          code: 'API_UNREACHABLE',
          message: e instanceof Error ? e.message : String(e),
          target,
        },
      },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyHeaders(upstream.headers),
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
