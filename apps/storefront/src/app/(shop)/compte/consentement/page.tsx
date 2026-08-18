import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { getLatestLegalDocument } from '@/lib/legal/getLatestLegalDocument';
import { hasValidTermsConsent } from '@/lib/legal/hasValidTermsConsent';
import { safeReturnPath } from '@/lib/legal/safeReturnPath';
import { ConsentementClient } from './ConsentementClient';

// Le check de consentement peut changer entre deux requêtes (nouvelle
// version CGV publiée après le login) — force-dynamic seul ne suffit pas sur
// Next.js 14.2.x, fetchCache doit être désactivé aussi (même règle que
// conditions-generales-vente/page.tsx, Ciclo 2).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ConsentementPage({
  searchParams,
}: {
  searchParams: { return?: string };
}) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');

  const returnPath = safeReturnPath(searchParams.return);

  // Accès direct à cette page (pas via le guard) alors que le consentement
  // est déjà valide — jamais d'écran inutile, redirect immédiat.
  const alreadyValid = await hasValidTermsConsent(tenant.id, customer.id);
  if (alreadyValid) redirect(returnPath);

  const terms = await getLatestLegalDocument(tenant.id, 'terms');

  // Aucun document publié pour ce tenant : rien à faire accepter — même
  // raisonnement que hasValidTermsConsent (qui aurait déjà renvoyé true dans
  // ce cas), garde de cohérence si jamais appelée directement.
  if (!terms) redirect(returnPath);

  const supabase = createServiceClient();
  const { data: marketingConsent } = await supabase
    .from('user_consents')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('user_id', customer.id)
    .eq('consent_type', 'marketing')
    .limit(1)
    .maybeSingle();

  return (
    <ConsentementClient
      tenantName={tenant.name}
      showMarketingCheckbox={!marketingConsent}
      returnPath={returnPath}
    />
  );
}
