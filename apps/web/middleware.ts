import { NextResponse, type NextRequest } from 'next/server';

// /rpc/* is the API proxy (Route Handler at app/rpc/[...path]/route.ts).
// The API itself enforces auth via session cookies, so the middleware must
// let these requests through untouched — including unauth POST /rpc/auth/login.
const PUBLIC_PATHS = ['/login', '/_next', '/favicon.ico', '/api/health', '/rpc'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies.get('session');
  if (!sessionCookie?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|rpc|_next/static|_next/image|favicon.ico).*)'],
};
