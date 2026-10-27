import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { isMissingLifecycleSchema } from '@/lib/billing/subscriptionRules';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const schema = z.object({
  paypalUrl: z.string().trim().max(300).url('Lien invalide.').startsWith('https://', 'Le lien doit commencer par https://.').nullable(),
});

/**
 * Lepefy's PayPal link shown to every tenant on /admin/billing
 * (platform_billing_settings.paypal_url, migration 169). Platform owner only.
 */
export async function POST(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'Origine refusée.' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Paramètres invalides.' }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { error } = await db.from('platform_billing_settings')
    .update({ paypal_url: parsed.data.paypalUrl || null, updated_at: new Date().toISOString() })
    .eq('id', 'default');
  if (error) {
    console.error('[platform/subscriptions/settings] update failed:', error);
    const message = isMissingLifecycleSchema(error) ? 'Migration 169 non appliquée.' : 'Enregistrement impossible.';
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
