import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { MAX_SUBSCRIPTION_CHANGES, parseSubscriptionChanges } from '@/lib/notifications/notificationTypes';
import { applyNotificationSubscriptionChanges } from '@/lib/notifications/notificationSubscriptions';

export const runtime = 'nodejs';

// One endpoint for every subscription edit: a single checkbox, a whole group,
// a column across recipients or a profile — all expressed as
// { changes: [{ recipientId, typeKey, subscribed }] }.
// Returns the canonical subscriptions of the recipients touched.
export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const changes = parseSubscriptionChanges(await req.json().catch(() => null));
  if (!changes) {
    return NextResponse.json({ error: `Modifications invalides (1 à ${MAX_SUBSCRIPTION_CHANGES}, types connus uniquement).` }, { status: 400 });
  }

  try {
    const recipients = await applyNotificationSubscriptionChanges(createServiceClient(), tenant.id, changes);
    if (!recipients) return NextResponse.json({ error: 'Destinataire introuvable.' }, { status: 404 });
    revalidatePath('/admin/parametres');
    return NextResponse.json({ recipients: recipients.map((r) => ({ id: r.id, subscriptions: r.subscriptions })) });
  } catch (error) {
    console.error('[notification-subscriptions] apply failed', error);
    return NextResponse.json({ error: 'Erreur lors de l’enregistrement.' }, { status: 500 });
  }
}
