import { redirect } from 'next/navigation';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import SourcesClient from './SourcesClient';

export const dynamic = 'force-dynamic';

export default async function ExternalCatalogSourcesPage() {
  if (await requirePlatformOwner()) redirect('/admin');
  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <AdminPageHeader
        title="Catalogues WhatsApp"
        description="Lire le catalogue WhatsApp d’un vendeur et appliquer, produit par produit, les données validées au catalogue d’un tenant."
      />
      <SourcesClient />
    </div>
  );
}
