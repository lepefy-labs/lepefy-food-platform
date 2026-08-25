import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { generateCheckoutSessionAccessToken } from '@/lib/checkout/checkoutSessionAccessToken';
import { notifyN8n } from '@/lib/events/notifyN8n';

const FIRST_REMINDER_DELAY_MS = 2 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 2;

interface SessionItem {
  name: string;
  price: number;
  quantity: number;
}

interface ReminderLog {
  id: string;
  created_at: string;
  detail: Record<string, unknown> | null;
}

function reminderLogsOnly(logs: ReminderLog[]) {
  return logs.filter((log) => log.detail?.kind === 'payment_reminder_sent');
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: rawSession, error: sessionError } = await supabase
    .from('checkout_sessions')
    .select('id, email, full_name, items, shipping_total, ambassador_discount_amount, status, expires_at, payment_method, external_payment_type, external_payment_label, order_id, created_at')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .in('status', ['open', 'awaiting_verification'])
    .is('order_id', null)
    .maybeSingle();

  if (sessionError) {
    console.error('[payment recovery reminder] session lookup failed:', sessionError, '— id:', params.id);
    return NextResponse.json({ error: 'Impossible de charger cette demande de paiement.' }, { status: 500 });
  }
  if (!rawSession) {
    return NextResponse.json({ error: 'Cette demande n’est plus éligible à un rappel.' }, { status: 409 });
  }

  const session = rawSession as {
    id: string;
    email: string;
    full_name: string | null;
    items: SessionItem[];
    shipping_total: number;
    ambassador_discount_amount: number | null;
    status: 'open' | 'awaiting_verification';
    expires_at: string;
    payment_method: 'external_link';
    external_payment_type: string | null;
    external_payment_label: string | null;
    order_id: string | null;
    created_at: string;
  };

  if (session.status === 'open' && new Date(session.expires_at).getTime() <= now.getTime()) {
    return NextResponse.json({ error: 'Cette session a expiré et ne peut plus être relancée.' }, { status: 409 });
  }

  const firstEligibleAt = new Date(new Date(session.created_at).getTime() + FIRST_REMINDER_DELAY_MS);
  if (now.getTime() < firstEligibleAt.getTime()) {
    return NextResponse.json({
      error: 'Le premier rappel sera disponible deux heures après la création de la demande.',
      nextReminderAt: firstEligibleAt.toISOString(),
    }, { status: 429 });
  }

  const { data: rawLogs, error: logsError } = await supabase
    .from('payment_funnel_logs')
    .select('id, created_at, detail')
    .eq('tenant_id', tenant.id)
    .eq('module', 'shop')
    .eq('reference_id', session.id)
    .eq('event_type', 'checkout_reused')
    .order('created_at', { ascending: false })
    .limit(30);

  if (logsError) {
    console.error('[payment recovery reminder] audit lookup failed:', logsError, '— id:', session.id);
    return NextResponse.json({ error: 'Impossible de vérifier l’historique des rappels.' }, { status: 500 });
  }

  const reminders = reminderLogsOnly((rawLogs ?? []) as ReminderLog[]);
  if (reminders.length >= MAX_REMINDERS) {
    return NextResponse.json({ error: 'Le nombre maximal de rappels a déjà été atteint.' }, { status: 429 });
  }

  const lastReminder = reminders[0] ?? null;
  if (lastReminder) {
    const nextReminderAt = new Date(new Date(lastReminder.created_at).getTime() + REMINDER_COOLDOWN_MS);
    if (now.getTime() < nextReminderAt.getTime()) {
      return NextResponse.json({
        error: 'Un rappel a déjà été envoyé récemment.',
        nextReminderAt: nextReminderAt.toISOString(),
      }, { status: 429 });
    }
  }

  if (!process.env.TRACKING_SECRET) {
    return NextResponse.json({ error: 'Le lien de reprise sécurisé n’est pas disponible.' }, { status: 503 });
  }

  const tenantContext = await getTenantNotificationContext(tenant.id);
  if (!tenantContext?.storefrontUrl) {
    return NextResponse.json({ error: 'L’URL canonique de la boutique n’est pas configurée.' }, { status: 503 });
  }

  const accessToken = generateCheckoutSessionAccessToken(session.id, session.email);
  const resumeLink = `${tenantContext.storefrontUrl}/checkout/reprendre/${session.id}?token=${encodeURIComponent(accessToken)}`;
  const subtotal = (session.items ?? []).reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0,
  );
  const amount = Number((subtotal + Number(session.shipping_total ?? 0) - Number(session.ambassador_discount_amount ?? 0)).toFixed(2));
  const reminderNumber = reminders.length + 1;
  const idempotencyKey = `payment-reminder:${session.id}:${reminderNumber}`;

  // Reserve the reminder slot before contacting n8n. This makes concurrent admin
  // clicks conservative: a second request sees the persisted slot instead of
  // sending a duplicate. A transport failure immediately marks the slot failed.
  const { data: reservation, error: reservationError } = await supabase
    .from('payment_funnel_logs')
    .insert({
      tenant_id: tenant.id,
      module: 'shop',
      reference_id: session.id,
      event_type: 'checkout_reused',
      detail: {
        kind: 'payment_reminder_sent',
        deliveryState: 'reserved',
        reminderNumber,
        idempotencyKey,
        paymentStatus: session.status,
      },
    })
    .select('id, created_at')
    .single();

  if (reservationError || !reservation) {
    console.error('[payment recovery reminder] reservation failed:', reservationError, '— id:', session.id);
    return NextResponse.json({ error: 'Impossible de réserver l’envoi du rappel.' }, { status: 500 });
  }

  const payload: Record<string, unknown> = {
    ...tenantContext,
    checkoutSessionId: session.id,
    paymentReference: `#${session.id.slice(0, 8).toUpperCase()}`,
    email: session.email,
    fullName: session.full_name ?? '',
    paymentMethod: {
      type: session.external_payment_type,
      label: session.external_payment_label ?? session.external_payment_type ?? 'Paiement externe',
    },
    amount,
    resumeLink,
    paymentStatus: session.status,
    providerHandoffStarted: session.status === 'awaiting_verification',
    reminderNumber,
    idempotencyKey,
    reminderSentAt: nowIso,
  };

  const delivered = await notifyN8n('/webhook/payment-reminder', payload);
  if (!delivered) {
    await supabase
      .from('payment_funnel_logs')
      .update({
        detail: {
          kind: 'payment_reminder_failed',
          deliveryState: 'failed',
          reminderNumber,
          idempotencyKey,
          paymentStatus: session.status,
        },
      })
      .eq('id', reservation.id)
      .eq('tenant_id', tenant.id);
    return NextResponse.json({ error: 'Le rappel n’a pas pu être transmis à n8n.' }, { status: 502 });
  }

  const { error: auditUpdateError } = await supabase
    .from('payment_funnel_logs')
    .update({
      detail: {
        kind: 'payment_reminder_sent',
        deliveryState: 'accepted_by_n8n',
        reminderNumber,
        idempotencyKey,
        paymentStatus: session.status,
      },
    })
    .eq('id', reservation.id)
    .eq('tenant_id', tenant.id);

  if (auditUpdateError) {
    console.error('[payment recovery reminder] audit finalize failed:', auditUpdateError, '— id:', session.id);
  }

  revalidatePath('/admin');
  revalidatePath(`/admin/paiements-en-attente/${session.id}`);
  revalidatePath('/admin/checkout-funnel');

  return NextResponse.json({
    ok: true,
    reminderCount: reminderNumber,
    lastReminderAt: reservation.created_at,
    nextReminderAt: reminderNumber < MAX_REMINDERS
      ? new Date(new Date(reservation.created_at).getTime() + REMINDER_COOLDOWN_MS).toISOString()
      : null,
  });
}
