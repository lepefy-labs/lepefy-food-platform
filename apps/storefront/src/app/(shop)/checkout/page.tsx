import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import CheckoutForm from './CheckoutForm';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const allMethods = await getTenantPaymentMethods(tenant.id);

  // Décision 7 — n'importe quelle ligne dont le type n'est ni bank_transfer
  // ni cash et dont extra.link est renseigné devient automatiquement une
  // option de paiement au checkout, sans rien coder en dur par tenant.
  const externalPaymentMethods = allMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link,
  );

  return <CheckoutForm tenant={tenant} externalPaymentMethods={externalPaymentMethods} />;
}
