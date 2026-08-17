import { getTenant } from '@/lib/tenant/getTenant';
import PendingEventPaymentClient from './PendingEventPaymentClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  searchParams: { ref?: string };
}

export default async function PendingEventPaymentPage({ searchParams }: PageProps) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <PendingEventPaymentClient
      requestId={searchParams.ref ?? null}
      whatsappNumber={tenant.whatsapp_number}
    />
  );
}
