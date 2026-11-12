import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { createSignedUpload } from '@/lib/studio/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/studio/uploads — signed upload URL of the private bucket:
 * the photo goes straight from the phone to Storage (no file through the
 * Vercel Function). The path is in this admin's own upload folder; the
 * server checks and adopts it on « Créer une proposition ».
 */
export async function POST() {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  try {
    const upload = await createSignedUpload(createServiceClient(), guard.tenant.id, guard.adminId);
    return NextResponse.json(upload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return studioErrorResponse(error, 'Envoi de la photo impossible pour le moment.');
  }
}
