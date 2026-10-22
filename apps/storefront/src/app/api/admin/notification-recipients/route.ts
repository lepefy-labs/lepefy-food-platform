import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  availableNotificationTypes, defaultNotificationTypeKeys, notificationTypeContext, parseTypeKeys, typeSupportsChannel,
} from '@/lib/notifications/notificationTypes';
import { isTenantTeamMember, loadNotificationRecipients } from '@/lib/notifications/notificationSubscriptions';
import { normalizeWhatsappPhone } from '@/lib/notifications/staff/staffWhatsapp';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { SUPPORT_FLAG } from '@/lib/support/domain';

export const runtime = 'nodejs';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  try {
    return NextResponse.json(await loadNotificationRecipients(createServiceClient(), tenant.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as {
    email?: unknown; whatsapp_phone?: unknown; label?: unknown; admin_user_id?: unknown; subscriptions?: unknown; whatsapp_subscriptions?: unknown;
  } | null;
  const email = typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null;
  if (email && !isValidEmail(email)) return NextResponse.json({ error: 'Email invalide.' }, { status: 400 });
  const rawPhone = typeof body?.whatsapp_phone === 'string' && body.whatsapp_phone.trim() ? body.whatsapp_phone : null;
  const whatsappPhone = rawPhone ? normalizeWhatsappPhone(rawPhone) : null;
  if (rawPhone && !whatsappPhone) {
    return NextResponse.json({ error: 'Numéro WhatsApp invalide : format international avec indicatif (ex. +39 333 123 4567).' }, { status: 400 });
  }
  if (!email && !whatsappPhone) return NextResponse.json({ error: 'Indiquez un email ou un numéro WhatsApp.' }, { status: 400 });

  // Omitted → catalogue defaults for the tenant's modules (email only).
  const emailSubscriptions = !email ? [] : body?.subscriptions === undefined
    ? defaultNotificationTypeKeys(availableNotificationTypes(notificationTypeContext(tenant, { support: await isFeatureEnabled(tenant.id, SUPPORT_FLAG) })))
    : parseTypeKeys(body.subscriptions);
  // WhatsApp starts empty unless explicitly chosen.
  const whatsappSubscriptions = !whatsappPhone || body?.whatsapp_subscriptions === undefined ? [] : parseTypeKeys(body.whatsapp_subscriptions);
  if (!emailSubscriptions || !whatsappSubscriptions || !whatsappSubscriptions.every((key) => typeSupportsChannel(key, 'whatsapp'))) {
    return NextResponse.json({ error: 'Type de notification inconnu.' }, { status: 400 });
  }

  const db = createServiceClient();
  const adminUserId = typeof body?.admin_user_id === 'string' && body.admin_user_id ? body.admin_user_id : null;
  if (adminUserId && !(await isTenantTeamMember(db, tenant.id, adminUserId))) {
    return NextResponse.json({ error: 'Membre de l’équipe introuvable.' }, { status: 400 });
  }

  const { data, error } = await db.from('tenant_notification_recipients').insert({
    tenant_id: tenant.id,
    email,
    whatsapp_phone: whatsappPhone,
    label: body?.label ? String(body.label).trim() : null,
    admin_user_id: adminUserId,
  }).select('id').single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: adminUserId ? 'Ce membre, cet email ou ce numéro est déjà enregistré.' : 'Cet email ou ce numéro est déjà enregistré.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = [
    ...emailSubscriptions.map((typeKey) => ({ tenant_id: tenant.id, recipient_id: data.id, type_key: typeKey, channel: 'email' })),
    ...whatsappSubscriptions.map((typeKey) => ({ tenant_id: tenant.id, recipient_id: data.id, type_key: typeKey, channel: 'whatsapp' })),
  ];
  if (rows.length > 0) {
    const { error: subError } = await db.from('tenant_notification_subscriptions').insert(rows);
    if (subError) {
      // No half-created recipient: roll back so the admin can retry as-is.
      await db.from('tenant_notification_recipients').delete().eq('id', data.id).eq('tenant_id', tenant.id);
      return NextResponse.json({ error: subError.message }, { status: 500 });
    }
  }

  const [created] = await loadNotificationRecipients(db, tenant.id, [data.id]);
  revalidatePath('/admin/parametres');
  return NextResponse.json(created, { status: 201 });
}
