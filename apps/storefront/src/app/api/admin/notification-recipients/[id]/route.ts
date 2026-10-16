import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isTenantTeamMember, loadNotificationRecipients } from '@/lib/notifications/notificationSubscriptions';
import { normalizeWhatsappPhone } from '@/lib/notifications/staff/staffWhatsapp';

export const runtime = 'nodejs';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

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
  if ('email' in body) {
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
    if (email && !isValidEmail(email)) return NextResponse.json({ error: 'Email invalide.' }, { status: 400 });
    updatePayload.email = email;
  }
  if ('whatsapp_phone' in body) {
    const raw = typeof body.whatsapp_phone === 'string' && body.whatsapp_phone.trim() ? body.whatsapp_phone : null;
    const phone = raw ? normalizeWhatsappPhone(raw) : null;
    if (raw && !phone) return NextResponse.json({ error: 'Numéro WhatsApp invalide : format international avec indicatif (ex. +39 333 123 4567).' }, { status: 400 });
    const { data: current } = await db.from('tenant_notification_recipients').select('whatsapp_phone').eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
    updatePayload.whatsapp_phone = phone;
    // A new (or removed) number must be confirmed again before anything is sent.
    if ((current as { whatsapp_phone: string | null } | null)?.whatsapp_phone !== phone) updatePayload.whatsapp_verified_at = null;
  }
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
    if (error.code === '23505') return NextResponse.json({ error: 'Ce membre, cet email ou ce numéro est déjà lié à un autre destinataire.' }, { status: 409 });
    if (error.code === '23514') return NextResponse.json({ error: 'Gardez au moins un email ou un numéro WhatsApp.' }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Destinataire introuvable.' }, { status: 404 });
  revalidatePath('/admin/parametres');
  const [recipient] = await loadNotificationRecipients(db, tenant.id, [params.id]);
  return NextResponse.json({ success: true, recipient });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  // Subscriptions cascade (FK on (tenant_id, recipient_id)); the delivery
  // history keeps its rows (recipient_id has no FK).
  const { data, error } = await createServiceClient().from('tenant_notification_recipients').delete().eq('id', params.id).eq('tenant_id', tenant.id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Destinataire introuvable.' }, { status: 404 });
  revalidatePath('/admin/parametres');
  return NextResponse.json({ success: true });
}
