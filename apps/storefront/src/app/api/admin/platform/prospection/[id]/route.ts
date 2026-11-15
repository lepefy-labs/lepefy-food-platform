import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { GROWTH_ID, prospectPatchSchema } from '@/lib/growth/validation';
import { getGrowthProspect, growthDb } from '@/lib/growth/server/repository';
import { syncSuppressions } from '@/lib/growth/server/suppressions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Message draft, next action and « do not contact » of a prospect (platform owner only). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({ error: 'Origine refusée.' }, { status: 403 });
  const parsed = prospectPatchSchema.safeParse(await req.json().catch(() => null));
  if (!GROWTH_ID.safeParse(params.id).success || !parsed.success) return NextResponse.json({ error: 'Champs invalides.' }, { status: 400 });
  const input = parsed.data;
  if (input.doNotContact && !input.doNotContactReason) return NextResponse.json({ error: 'Indiquez pourquoi ce commerce ne doit plus être contacté.' }, { status: 400 });
  try {
    const current = await getGrowthProspect(params.id);
    if (!current) return NextResponse.json({ error: 'Fiche introuvable.' }, { status: 404 });
    const update: Record<string, unknown> = {};
    if (input.messageDraft !== undefined) update.message_draft = input.messageDraft?.trim() ? input.messageDraft : null;
    if (input.nextActionAt !== undefined) update.next_action_at = input.nextActionAt;
    if (input.doNotContact !== undefined) {
      update.do_not_contact = input.doNotContact;
      update.do_not_contact_reason = input.doNotContact ? input.doNotContactReason : null;
      if (input.doNotContact) update.next_action_at = null;
    }
    if (!Object.keys(update).length) return NextResponse.json({ ok: true });
    const saved = await growthDb().from('growth_prospects').update(update).eq('id', params.id).eq('updated_at', input.expectedUpdatedAt).select('id');
    if (saved.error) throw new Error('save_failed');
    if (!saved.data?.length) return NextResponse.json({ error: 'La fiche a changé. Rechargez-la avant de réessayer.' }, { status: 409 });
    if (input.doNotContact !== undefined) await syncSuppressions(current, input.doNotContact, input.doNotContactReason ?? null);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Enregistrement impossible. Vérifiez la migration 185.' }, { status: 503 });
  }
}
