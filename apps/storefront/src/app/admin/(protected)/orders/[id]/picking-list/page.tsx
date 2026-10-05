import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Ancienne page imprimable (window.print). Conservée comme redirection pour les
// favoris : le document fait foi est désormais le PDF serveur (Gotenberg).
export default function PickingListPage({ params }: { params: { id: string } }) {
  redirect(`/api/admin/orders/${encodeURIComponent(params.id)}/documents/picking-list`);
}
