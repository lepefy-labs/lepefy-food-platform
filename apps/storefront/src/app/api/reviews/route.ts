import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { submitVerifiedReview } from '@/lib/reviews/reviewService';

const schema = z.object({
  orderId: z.string().uuid().nullable().optional(),
  token: z.string().min(20).max(200).nullable().optional(),
  rating: z.number().int().min(1).max(5),
  body: z.string().max(2000).nullable().optional(),
}).refine((value) => Boolean(value.orderId || value.token), { message: 'orderId or token required' });

export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  try {
    const review = await submitVerifiedReview({ tenantId: tenant.id, ...parsed.data });
    return NextResponse.json({ ok: true, review });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'review_failed';
    if (code === 'reviews_disabled') return NextResponse.json({ error: 'Les avis ne sont pas disponibles.' }, { status: 404 });
    if (code === 'review_not_authorized') return NextResponse.json({ error: 'Ce lien ou cette commande ne permet pas de déposer un avis.' }, { status: 403 });
    if (code === 'review_already_exists') return NextResponse.json({ error: 'Un avis a déjà été déposé pour cette commande.' }, { status: 409 });
    if (code === 'review_rating_invalid' || code === 'review_body_too_long') return NextResponse.json({ error: 'Avis invalide.' }, { status: 400 });
    console.error('[reviews] submission failed', { code });
    return NextResponse.json({ error: 'Impossible d’enregistrer votre avis.' }, { status: 500 });
  }
}
