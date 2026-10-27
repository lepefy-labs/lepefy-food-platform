import { NextResponse } from 'next/server';
import { buildAdminManifest } from '@/lib/admin/adminManifest';

// Static, tenant-independent and unauthenticated (browsers fetch it without
// credentials): it carries no data beyond the Lepefy Admin brand.
export function GET() {
  return new NextResponse(JSON.stringify(buildAdminManifest()), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, must-revalidate',
    },
  });
}
