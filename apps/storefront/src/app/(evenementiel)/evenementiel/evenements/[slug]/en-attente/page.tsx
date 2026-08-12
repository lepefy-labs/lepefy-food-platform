import PendingEventPaymentClient from './PendingEventPaymentClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  searchParams: { ref?: string };
}

export default function PendingEventPaymentPage({ searchParams }: PageProps) {
  return <PendingEventPaymentClient requestId={searchParams.ref ?? null} />;
}
