import { getTenant } from '@/lib/tenant/getTenant';
import EventConfirmationClient from './EventConfirmationClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  searchParams: { payment_intent?: string };
}

export default async function EventConfirmationPage({ searchParams }: PageProps) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <EventConfirmationClient
      paymentIntentId={searchParams.payment_intent ?? null}
      whatsappNumber={tenant.whatsapp_number}
    />
  );
}
