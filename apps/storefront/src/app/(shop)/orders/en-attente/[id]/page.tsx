import { redirect } from 'next/navigation';

export default function LegacyPendingCheckoutPage({ params }: { params: { id: string } }) {
  redirect(`/checkout/reprendre/${params.id}`);
}
