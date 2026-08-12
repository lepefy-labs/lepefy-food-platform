import PendingRentalPaymentClient from './PendingRentalPaymentClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  searchParams: { ref?: string };
}

export default function PendingRentalPaymentPage({ searchParams }: PageProps) {
  return <PendingRentalPaymentClient requestId={searchParams.ref ?? null} />;
}
