import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isTenantTeamMember } from '@/lib/notifications/notificationSubscriptions';

export const runtime = 'nodejs';

// Recipient fields only; subscriptions go through ./subscriptions (batch).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const db = createServiceClient();
  const updatePayload: Record<string, unknown> = {};
  if ('label' in body) updatePayload.label = body.label ? String(body.label).trim() : null;
  if ('active' in body) updatePayload.active = Boolean(body.active);
  if ('admin_user_id' in body) {
    const adminUserId = typeof body.admin_user_id === 'string' && body.admin_user_id ? body.admin_user_id : null;
    if (adminUserId && !(await isTenantTeamMember(db, tenant.id, adminUserId))) {
      return NextResponse.json({ error: 'Membre de l’équipe introuvable.' }, { status: 400 });
    }
    updatePayload.admin_user_id = adminUserId;
  }
  if (Object.keys(updatePayload).length === 0) return NextResponse.json({ error: 'Aucune modification.' }, { status: 400 });

  const { data, error } = await db.from('tenant_notification_recipients').update(updatePayload).eq('id', params.id).eq('tenant_id', tenant.id).select('id').maybeSingle();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Ce membre est déjà lié à un autre destinataire.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Destinataire introuvable.' }, { status: 404 });
  revalidatePath('/admin/parametres');
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  // Subscriptions cascade (FK on (tenant_id, recipient_id)).
  const { data, error } = await createServiceClient().from('tenant_notification_recipients').delete().eq('id', params.id).eq('tenant_id', tenant.id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Destinataire introuvable.' }, { status: 404 });
  revalidatePath('/admin/parametres');
  return NextResponse.json({ success: true });
}
