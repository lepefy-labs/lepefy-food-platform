import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { GROWTH_ID, touchIssues, touchSchema } from '@/lib/growth/validation';
import { getGrowthProspect, growthDb, listTouches, whatsappSentToday } from '@/lib/growth/server/repository';
import { syncSuppressions } from '@/lib/growth/server/suppressions';
import { hasOptOut, stageAfterTouch, whatsappDecision } from '@/lib/growth/contactPolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WRITTEN = new Set(['whatsapp', 'email', 'instagram', 'modulo']);

/**
 * Records a contact made by the platform owner (Lepefy sends nothing itself).
 * The stage follows the outcome (stageAfterTouch); the WhatsApp rules are
 * re-checked here so the page cannot be bypassed.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({ error: 'Origine refusée.' }, { status: 403 });
  const parsed = touchSchema.safeParse(await req.json().catch(() => null));
  if (!GROWTH_ID.safeParse(params.id).success || !parsed.success) return NextResponse.json({ error: 'Champs invalides.' }, { status: 400 });
  const input = parsed.data;
  const issues = touchIssues(input);
  if (issues.length) return NextResponse.json({ error: issues[0], issues }, { status: 400 });
  if (input.outcome === 'contattato' && WRITTEN.has(input.channel)) {
    if (!input.messageText) return NextResponse.json({ error: 'Collez le message envoyé.' }, { status: 400 });
    if (!hasOptOut(input.messageText)) return NextResponse.json({ error: 'Le message écrit doit proposer de ne plus être recontacté.' }, { status: 400 });
  }
  try {
    const prospect = await getGrowthProspect(params.id);
    if (!prospect) return NextResponse.json({ error: 'Fiche introuvable.' }, { status: 404 });
    const previous = await listTouches(prospect.id);
    if (input.channel === 'whatsapp' && input.outcome === 'contattato') {
      const decision = whatsappDecision({
        country: prospect.country, doNotContact: prospect.do_not_contact, stage: prospect.sales_stage,
        touches: previous.length, whatsappTouches: previous.filter((t) => t.channel === 'whatsapp').length,
        whatsappSentToday: await whatsappSentToday(), chatOrdersConfirmed: prospect.evaluation?.signals?.chatOrders === 'confirmed',
      });
      if (!decision.allowed) return NextResponse.json({ error: decision.blockedReason }, { status: 409 });
    } else if (prospect.do_not_contact && input.outcome === 'contattato') {
      return NextResponse.json({ error: 'Ce commerce a demandé à ne plus être contacté.' }, { status: 409 });
    }

    const occurredAt = new Date().toISOString();
    const requestKey = z.string().uuid().safeParse(input.requestKey).success ? input.requestKey : null;
    const inserted = await growthDb().from('growth_prospect_touches').insert({
      prospect_id: prospect.id, occurred_at: occurredAt, channel: input.channel, outcome: input.outcome,
      reason: input.reason, note: input.note, message_text: input.messageText, request_key: requestKey,
    });
    if (inserted.error) {
      if (inserted.error.code === '23505') return NextResponse.json({ ok: true, duplicate: true });
      throw new Error('touch_failed');
    }
    const stage = stageAfterTouch(prospect.sales_stage, input.outcome);
    const closed = stage === 'perso' || stage === 'cliente';
    const update: Record<string, unknown> = {
      sales_stage: stage,
      last_contact_at: occurredAt,
      next_action_at: closed ? null : input.nextActionAt ?? null,
    };
    if (input.doNotContact) { update.do_not_contact = true; update.do_not_contact_reason = input.reason; }
    const saved = await growthDb().from('growth_prospects').update(update).eq('id', prospect.id);
    if (saved.error) throw new Error('save_failed');
    if (input.doNotContact) await syncSuppressions(prospect, true, input.reason);
    return NextResponse.json({ ok: true, stage });
  } catch {
    return NextResponse.json({ error: 'Enregistrement impossible. Vérifiez la migration 185.' }, { status: 503 });
  }
}
