import { NextRequest, NextResponse } from 'next/server';

/**
 * Forward only the minimum request context needed by the central admin API
 * capability resolver. Scoped to /api/admin so storefront traffic is not
 * affected by this middleware.
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-lepefy-admin-path', request.nextUrl.pathname);
  requestHeaders.set('x-lepefy-admin-method', request.method);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/api/admin/:path*'],
};
