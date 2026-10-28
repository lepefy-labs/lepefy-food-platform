import { NextResponse } from 'next/server';

// Lightweight deployment identifier for the PWA update check
// (lib/pwa/lifecycle.ts, docs/PWA_LIFECYCLE.md). No database, no tenant, no
// user data: only the commit SHA the running deployment was built from.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { v: process.env.VERCEL_GIT_COMMIT_SHA ?? '' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
