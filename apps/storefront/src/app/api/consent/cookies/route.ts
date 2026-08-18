import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';

interface ConsentBody {
  analytics?: boolean;
  marketing?: boolean;
}

// POST /api/consent/cookies — sync serveur du choix cookie du bandeau.
// Le cookie lepefy_cookie_consent côté client reste la source de vérité
// pour les guests : ici on ne fait qu'ajouter une ligne d'audit dans
// user_consents quand une session existe, jamais bloquant pour l'UX.
export async function POST(req: NextRequest) {
  const body = await req.json() as ConsentBody;
  const analytics = body.analytics === true;
  const marketing = body.marketing === true;

  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    // Guest : aucun order_id disponible dans ce contexte, pas de ligne
    // orpheline créée — le cookie client reste la seule trace.
    return NextResponse.json({ success: true });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('user_consents').insert([
    {
      tenant_id: tenant.id,
      user_id: sessionCustomer.id,
      consent_type: 'cookies_analytics',
      granted: analytics,
      source: 'cookie_banner',
    },
    {
      tenant_id: tenant.id,
      user_id: sessionCustomer.id,
      consent_type: 'cookies_marketing',
      granted: marketing,
      source: 'cookie_banner',
    },
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
