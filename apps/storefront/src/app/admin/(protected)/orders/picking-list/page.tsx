import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Ancienne impression groupée (window.print). Redirige vers le PDF groupé serveur.
export default function BulkPickingListPage({ searchParams }: { searchParams: { ids?: string } }) {
  redirect(`/api/admin/orders/documents/picking-list?ids=${encodeURIComponent(searchParams.ids ?? '')}`);
}
