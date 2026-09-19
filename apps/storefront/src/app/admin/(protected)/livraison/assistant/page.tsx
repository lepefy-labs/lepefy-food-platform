import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { AssistantClient } from './AssistantClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default function AdminShippingAssistantPage() {
  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Estimation basée sur l'historique — jamais un devis garanti. Demandez toujours un devis Packlink à jour avant une expédition réelle."
      />

      <LivraisonTabs active="assistant" />

      <AssistantClient />
    </div>
  );
}
