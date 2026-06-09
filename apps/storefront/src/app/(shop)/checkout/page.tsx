import { getTenant } from '@/lib/tenant/getTenant';
import CheckoutForm from './CheckoutForm';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return <CheckoutForm tenant={tenant} />;
}
