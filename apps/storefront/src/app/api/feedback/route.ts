import { NextRequest, NextResponse } from 'next/server';
import { buildFeedbackInsert, publicFeedbackSchema } from '@/lib/feedback/contracts';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 12_000;
const COOLDOWN_COOKIE = 'lepefy_feedback_cooldown';

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError('Requête refusée.', 403);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return jsonError('Message trop volumineux.', 413);
  if (request.cookies.has(COOLDOWN_COOKIE)) return jsonError('Patientez quelques secondes avant un nouvel envoi.', 429);

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonError('Message trop volumineux.', 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return jsonError('Données invalides.', 400);
  }
  const parsed = publicFeedbackSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'Données invalides.', 400);

  // Honeypot submissions receive a neutral success response without persistence.
  if (parsed.data.website) return NextResponse.json({ ok: true });
  if (parsed.data.dwellMs < 800) return jsonError('Prenez un instant pour vérifier votre message.', 429);

  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any;
    const { data: campaign, error: campaignError } = await service
      .from('tester_feedback_campaigns')
      .select('id, version_label')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .maybeSingle();

    if (campaignError || !campaign) return jsonError('Cette campagne n’est plus disponible.', 409);

    const { error } = await service.from('tester_feedback_entries').insert({
      tenant_id: tenant.id,
      campaign_id: campaign.id,
      ...buildFeedbackInsert(parsed.data, campaign.version_label),
    });
    if (error) return jsonError('Envoi impossible. Réessayez dans un instant.', 503);

    const response = NextResponse.json({ ok: true }, { status: 201 });
    response.cookies.set(COOLDOWN_COOKIE, '1', {
      httpOnly: true,
      maxAge: 20,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/feedback',
    });
    return response;
  } catch {
    return jsonError('Envoi impossible. Réessayez dans un instant.', 503);
  }
}
