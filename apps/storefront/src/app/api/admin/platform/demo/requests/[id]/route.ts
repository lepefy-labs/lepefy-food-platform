/**
 * PATCH /api/admin/platform/demo/requests/[id] — suivi d'une demande
 * « Demander ma propre boutique » : statut (new | contacted | closed) et note.
 * Propriétaire de la plateforme uniquement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['new', 'contacted', 'closed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const body = await request.json().catch(() => null) as { status?: unknown; note?: unknown } | null;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.has(body.status)) return NextResponse.json({ error: 'Statut inconnu.' }, { status: 400 });
    patch.status = body.status;
  }
  if (body?.note !== undefined) {
    if (body.note !== null && (typeof body.note !== 'string' || body.note.length > 1000)) {
      return NextResponse.json({ error: 'La note fait 1 000 caractères au plus.' }, { status: 400 });
    }
    patch.handled_note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  }
  const { data, error } = await createServiceClient().from('demo_requests').update(patch).eq('id', params.id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'La demande n’a pas pu être mise à jour. Réessayez.' }, { status: 503 });
  if (!data) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
