/**
 * Présentation en cours (bail) de la démo — propriétaire de la plateforme.
 * POST : démarre ou prolonge (minutes, 15 à 480). DELETE : termine.
 * Tant qu'un bail est actif, la réinitialisation (nocturne ou manuelle) refuse.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getDemoContext } from '@/lib/demo/server/demoContext';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NOT_DEMO = { error: 'Ce déploiement n’est pas une démo.' };

export async function POST(request: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const demo = await getDemoContext();
  if (!demo) return NextResponse.json(NOT_DEMO, { status: 409 });
  const body = await request.json().catch(() => null) as { minutes?: unknown } | null;
  const minutes = typeof body?.minutes === 'number' && Number.isInteger(body.minutes) ? body.minutes : 120;
  const access = await getCurrentAdminAccessContext(null);
  const startedBy = access?.nickname || [access?.firstName, access?.lastName].filter(Boolean).join(' ') || access?.email || 'Lepefy';
  const { data, error } = await createServiceClient().rpc('demo_start_presentation', {
    p_tenant_id: demo.tenant.id, p_started_by: startedBy.slice(0, 200), p_minutes: minutes,
  });
  if (error) {
    console.error('[platform/demo/presentation] start failed:', error.message);
    return NextResponse.json({ error: 'La présentation n’a pas pu démarrer. Réessayez.' }, { status: 503 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { out_expires_at: string; out_extended: boolean } | null;
  return NextResponse.json({ ok: true, expiresAt: row?.out_expires_at ?? null, extended: row?.out_extended ?? false });
}

export async function DELETE() {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!(await getDemoContext())) return NextResponse.json(NOT_DEMO, { status: 409 });
  const { error } = await createServiceClient().from('demo_presentations')
    .update({ ended_at: new Date().toISOString() })
    .is('ended_at', null);
  if (error) return NextResponse.json({ error: 'La présentation n’a pas pu être terminée. Réessayez.' }, { status: 503 });
  return NextResponse.json({ ok: true });
}
