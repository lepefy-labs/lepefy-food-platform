/**
 * POST /api/demo/requests — « Demander ma propre boutique ».
 * Démo uniquement. Consentement obligatoire, champ piège anti-robot, 3 demandes
 * par heure et par connexion. Aucun e-mail automatique : la demande attend dans
 * la console démo du propriétaire de la plateforme.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDemoContext, hasDemoAccess } from '@/lib/demo/server/demoContext';
import { countDemoEvent, demoBucket, demoRateAllowed } from '@/lib/demo/server/demoServices';
import { validateDemoRequest } from '@/lib/demo/demoRequest';
import { DEMO_REQUEST_CONSENT_VERSION } from '@/lib/demo/demoEnvironment';
import { createServiceClient } from '@/lib/supabase/server';
import { clientIp } from '@/lib/http/memoryRateLimit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const demo = await getDemoContext();
  if (!demo || !hasDemoAccess()) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  // Champ piège invisible : un robot le remplit, on répond comme si tout allait bien.
  if (typeof body?.website === 'string' && body.website.trim()) return NextResponse.json({ ok: true });

  const validation = validateDemoRequest(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error, field: validation.field }, { status: 400 });

  if (!(await demoRateAllowed(demoBucket('request', clientIp(request.headers)), 3, 3600))) {
    return NextResponse.json({ error: 'Plusieurs demandes ont déjà été envoyées depuis cette connexion. Réessayez plus tard.' }, { status: 429 });
  }

  const { value } = validation;
  const { error } = await createServiceClient().from('demo_requests').insert({
    business_name: value.businessName,
    city: value.city,
    contact_email: value.email,
    contact_phone: value.phone,
    message: value.message,
    interests: value.interests,
    consent_version: DEMO_REQUEST_CONSENT_VERSION,
  });
  if (error) {
    console.error('[demo/requests] not saved:', error.message);
    return NextResponse.json({ error: 'La demande n’a pas pu être enregistrée. Réessayez dans un instant.' }, { status: 503 });
  }
  await countDemoEvent('request.sent');
  return NextResponse.json({ ok: true });
}
