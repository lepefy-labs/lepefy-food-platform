import { NextRequest, NextResponse } from 'next/server';
import { legacyAdminRedirect, normalizeAdminHost, pwaLaunchRedirect } from '@/lib/admin/adminHost';
import { ADMIN_WORKSPACE_COOKIE } from '@/lib/admin/workspace';

/**
 * Single storefront middleware for admin page routing context and central
 * capability-driven authorization of /api/admin handlers.
 *
 * Keep these headers internal to the current request only. They are consumed
 * by the protected admin layout and requireAdmin() compatibility guard.
 */
export function middleware(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;

  if (!pathname.startsWith('/api/admin/')) {
    // Installed Lepefy Admin opened from its icon: reopen the last workspace.
    // The cookie only picks a destination; the layout still checks permissions.
    const launch = pwaLaunchRedirect({ pathname, source: searchParams.get('source'), workspaceCookie: request.cookies.get(ADMIN_WORKSPACE_COOKIE)?.value });
    if (launch) return NextResponse.redirect(new URL(launch, request.url));

    // Optional retirement of /admin on the storefront host (off unless ADMIN_LEGACY_REDIRECT=1).
    const legacy = legacyAdminRedirect({
      enabled: process.env.ADMIN_LEGACY_REDIRECT === '1',
      canonicalHost: normalizeAdminHost(process.env.ADMIN_HOST),
      storefrontHost: normalizeAdminHost(process.env.NEXT_PUBLIC_APP_URL),
      host: request.headers.get('host') ?? '',
      pathname,
      search,
    });
    if (legacy) return NextResponse.redirect(legacy);
  }

  const requestHeaders = new Headers(request.headers);
  // Always regenerated, never taken from the client: it keys the verified admin
  // actor of the Journal d'activité (lib/audit/requestContext.ts) and is the
  // correlation id of every event written by this request.
  requestHeaders.set('x-request-id', crypto.randomUUID());

  if (pathname.startsWith('/api/admin/')) {
    requestHeaders.set('x-lepefy-admin-path', pathname);
    requestHeaders.set('x-lepefy-admin-method', request.method);
  } else {
    requestHeaders.set('x-admin-path', pathname);
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
