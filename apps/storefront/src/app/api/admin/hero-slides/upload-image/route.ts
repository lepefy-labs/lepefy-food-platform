import { NextRequest, NextResponse } from 'next/server';
import { POST as uploadImage } from '../../evenementiel/upload-image/route';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Slide images with the catalogue permission of this page (adminApiPermissions:
// /api/admin/hero-slides → catalog.manage). The shared uploader is reused, but
// only for the « hero-slide » kind: event images keep event_content.manage.
export async function POST(req: NextRequest) {
  const form = await req.clone().formData().catch(() => null);
  if (form?.get('kind') !== 'hero-slide') {
    return NextResponse.json({ error: 'Type d’image non autorisé ici.' }, { status: 400 });
  }
  return uploadImage(req);
}
