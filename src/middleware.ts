import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page, static assets, and login API
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const authToken = req.cookies.get('auth_token')?.value;

  // If no auth token cookie is present, block access and redirect to /login
  if (!authToken || authToken !== 'authenticated_session_token_schottenhof') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Nicht autorisiert. Bitte anmelden.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
