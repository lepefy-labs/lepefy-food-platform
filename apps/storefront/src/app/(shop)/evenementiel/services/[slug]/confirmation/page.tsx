import RentalConfirmationClient from './RentalConfirmationClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { payment_intent?: string };
}

export default function RentalConfirmationPage({ searchParams }: PageProps) {
  return <RentalConfirmationClient paymentIntentId={searchParams.payment_intent ?? null} />;
}
