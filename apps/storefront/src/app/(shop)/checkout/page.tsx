import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { resolveCheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { isE2ERequest } from '@/lib/e2e/isE2ERequest';
import CheckoutFlow from './CheckoutFlow';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const allMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allMethods.filter(
    (method) => method.method !== 'bank_transfer' && method.method !== 'cash' && !!method.extra?.link
      && method.enabled_modules.includes('shop'),
  );
  const sessionCustomer = await getSessionCustomer(tenant.id);
  const consentState = await resolveCheckoutConsentState(tenant.id, sessionCustomer?.id ?? null);

  return (
    <div className="checkout-funnel">
      <CheckoutFlow
        tenant={tenant}
        externalPaymentMethods={externalPaymentMethods}
        consentState={consentState}
        isE2ETest={isE2ERequest()}
      />
    </div>
  );
}
