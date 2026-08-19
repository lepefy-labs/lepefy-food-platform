import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import PendingPaymentClient from './PendingPaymentClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { ref?: string };
}

export default async function PendingPaymentPage({ searchParams }: PageProps) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const allMethods = await getTenantPaymentMethods(tenant.id);

  // Même filtre que /checkout/page.tsx (Décision 7) — nécessaire pour que
  // l'éditeur puisse proposer un changement de moyen de paiement identique
  // au checkout d'origine.
  const externalPaymentMethods = allMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('shop'),
  );

  return (
    <PendingPaymentClient
      sessionId={searchParams.ref ?? null}
      tenant={tenant}
      externalPaymentMethods={externalPaymentMethods}
    />
  );
}
