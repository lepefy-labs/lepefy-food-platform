import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { getLatestLegalDocument } from '@/lib/legal/getLatestLegalDocument';
import { insertConsentRows, type ConsentRow } from '@/lib/legal/insertConsentRows';
import { safeReturnPath } from '@/lib/legal/safeReturnPath';

interface ReconsentBody {
  marketingOptIn?: boolean;
  returnPath?: string;
}

// POST /api/consent/reconsent-gate — accepte le gate de re-consentement
// (Ciclo 6). Session obligatoire (le gate ne concerne que les comptes déjà
// authentifiés) — jamais appelé pour un guest.
export async function POST(req: NextRequest) {
  try {
    const body: ReconsentBody = await req.json();

    const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant      = await getTenant(tenantSlug);

    const sessionCustomer = await getSessionCustomer(tenant.id);
    if (!sessionCustomer) {
      return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
    }

    const terms = await getLatestLegalDocument(tenant.id, 'terms');
    const redirectTo = safeReturnPath(body.returnPath);

    // Aucun document publié : rien à accepter, mais la requête reste
    // valide (même raisonnement que hasValidTermsConsent) — pas d'erreur.
    if (!terms) {
      return NextResponse.json({ redirectTo });
    }

    const supabase = createServiceClient();

    // Re-vérifié côté serveur, jamais fourni par le client : la case
    // marketing n'a de sens à enregistrer que si aucun choix n'a encore été
    // fait — même garde que resolveCheckoutConsentState (Ciclo 5).
    const { data: marketingConsent } = await supabase
      .from('user_consents')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('user_id', sessionCustomer.id)
      .eq('consent_type', 'marketing')
      .limit(1)
      .maybeSingle();

    const rows: ConsentRow[] = [
      {
        tenant_id:    tenant.id,
        user_id:      sessionCustomer.id,
        consent_type: 'terms',
        granted:      true,
        doc_version:  terms.version,
        source:       'reconsent_gate',
      },
    ];

    if (!marketingConsent) {
      rows.push({
        tenant_id:    tenant.id,
        user_id:      sessionCustomer.id,
        consent_type: 'marketing',
        granted:      body.marketingOptIn === true,
        doc_version:  null,
        source:       'reconsent_gate',
      });
    }

    await insertConsentRows(supabase, rows);

    return NextResponse.json({ redirectTo });
  } catch (err) {
    console.error('[api/consent/reconsent-gate] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
