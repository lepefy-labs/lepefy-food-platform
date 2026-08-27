import { NextRequest, NextResponse } from 'next/server';

/**
 * Single storefront middleware for admin page routing context and central
 * capability-driven authorization of /api/admin handlers.
 *
 * Keep these headers internal to the current request only. They are consumed
 * by the protected admin layout and requireAdmin() compatibility guard.
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  if (request.nextUrl.pathname.startsWith('/api/admin/')) {
    requestHeaders.set('x-lepefy-admin-path', request.nextUrl.pathname);
    requestHeaders.set('x-lepefy-admin-method', request.method);
  } else {
    requestHeaders.set('x-admin-path', request.nextUrl.pathname);
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/admin/:path*', '/scan', '/api/admin/:path*'],
};
