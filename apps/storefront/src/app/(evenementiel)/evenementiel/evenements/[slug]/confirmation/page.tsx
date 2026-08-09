import EventConfirmationClient from './EventConfirmationClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { payment_intent?: string };
}

export default function EventConfirmationPage({ searchParams }: PageProps) {
  return <EventConfirmationClient paymentIntentId={searchParams.payment_intent ?? null} />;
}
