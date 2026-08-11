import { getTenant } from '@/lib/tenant/getTenant';
import PendingPaymentClient from './PendingPaymentClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { ref?: string };
}

export default async function PendingPaymentPage({ searchParams }: PageProps) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');

  return (
    <PendingPaymentClient
      sessionId={searchParams.ref ?? null}
      currency={tenant.currency}
    />
  );
}
