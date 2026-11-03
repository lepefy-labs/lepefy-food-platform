import { getTenant } from '@/lib/tenant/getTenant';
import { toPublicTenant } from '@/lib/tenant/publicTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { resolveCheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { isE2ERequest } from '@/lib/e2e/isE2ERequest';
import CheckoutFlow from './CheckoutFlow';
import styles from './checkoutSticky.module.css';
import { isLinkPaymentMethod } from '@/lib/payments/externalPaymentLink';
import { createServiceClient } from '@/lib/supabase/server';
import { loadConfiguredCountries, loadGeoPolicy } from '@/lib/shipping/geo/geoPolicyServer';
import { destinationCountryList } from '@/lib/shipping/geo/geoPolicy';
import { phoneCountries } from '@/lib/address/countries';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const [allMethods, sessionCustomer] = await Promise.all([
    getTenantPaymentMethods(tenant.id),
    getSessionCustomer(tenant.id),
  ]);
  const externalPaymentMethods = allMethods.filter(
    (method) => isLinkPaymentMethod(method)
      && method.enabled_modules.includes('shop'),
  );
  const consentState = await resolveCheckoutConsentState(tenant.id, sessionCustomer?.id ?? null);

  // Pays proposés = politique du tenant (la livraison réelle reste décidée par le devis serveur).
  let deliveryCountries: string[] | undefined;
  try {
    const supabase = createServiceClient();
    const [policy, configured] = await Promise.all([loadGeoPolicy(supabase, tenant.id), loadConfiguredCountries(supabase, tenant.id)]);
    // Aucune politique enregistrée (version 0): liste historique inchangée.
    if (policy.version > 0) {
      const catalog = phoneCountries('fr', [tenant.country]).map((c) => c.code);
      const list = destinationCountryList(policy, configured, catalog);
      if (list.length > 0) deliveryCountries = list;
    }
  } catch {
    deliveryCountries = undefined; // liste historique
  }

  return (
    <div className={styles.checkoutFunnel}>
      <CheckoutFlow
        tenant={toPublicTenant(tenant)}
        externalPaymentMethods={externalPaymentMethods}
        consentState={consentState}
        isE2ETest={isE2ERequest()}
        deliveryCountries={deliveryCountries}
      />
    </div>
  );
}
