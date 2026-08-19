import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { resolveCheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { isE2ERequest } from '@/lib/e2e/isE2ERequest';
import CheckoutForm from './CheckoutForm';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const allMethods = await getTenantPaymentMethods(tenant.id);

  // Décision 7 — n'importe quelle ligne dont le type n'est ni bank_transfer
  // ni cash et dont extra.link est renseigné devient automatiquement une
  // option de paiement au checkout, sans rien coder en dur par tenant.
  const externalPaymentMethods = allMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('shop'),
  );

  // Ciclo 5 — déterminé côté serveur pour ne jamais redemander un consentement
  // déjà valide : un utilisateur loggé avec sessionCustomer=null ici (guest)
  // voit toujours les deux cases, comme au premier signup.
  const sessionCustomer = await getSessionCustomer(tenant.id);
  const consentState = await resolveCheckoutConsentState(tenant.id, sessionCustomer?.id ?? null);

  return (
    <CheckoutForm
      tenant={tenant}
      externalPaymentMethods={externalPaymentMethods}
      consentState={consentState}
      isE2ETest={isE2ERequest()}
    />
  );
}
