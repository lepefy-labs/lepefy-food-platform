import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  // Restriction stricte à platform_owner — même pattern que
  // api/admin/team/invite/route.ts (allowedRoles vide).
  const denied = await requireAdmin('', []);
  if (denied) return denied;

  const currentAdminId = await getAdminId();
  if (!currentAdminId) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  if (params.id === currentAdminId) {
    return NextResponse.json(
      { error: 'Vous ne pouvez pas désactiver votre propre compte.' },
      { status: 400 },
    );
  }

  let body: { active?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 });
  }

  if (typeof body.active !== 'boolean') {
    return NextResponse.json({ error: '"active" doit être un booléen.' }, { status: 400 });
  }

  const adminClient = createServiceClient();

  const { data, error } = await adminClient
    .from('admin_users')
    .update({ active: body.active })
    .eq('id', params.id)
    .select('id')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Administrateur introuvable.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
