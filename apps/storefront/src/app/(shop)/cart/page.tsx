import { getTenant } from '@/lib/tenant/getTenant';
import CartPurchaseClient from './CartPurchaseClient';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return <CartPurchaseClient tenant={tenant} />;
}
