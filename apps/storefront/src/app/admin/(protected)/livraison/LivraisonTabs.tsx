import AdminTabs from '../../_components/ui/Tabs';

type LivraisonTab =
  | 'rules' | 'packaging' | 'expeditions' | 'assistant' | 'historique' | 'tarif-analyse' | 'forfait-shadow';

const TABS: Array<{ key: LivraisonTab; href: string; label: string }> = [
  { key: 'rules', href: '/admin/livraison', label: 'Tarification' },
  { key: 'packaging', href: '/admin/livraison/emballages', label: 'Emballages' },
  { key: 'expeditions', href: '/admin/livraison/expeditions', label: 'Expéditions' },
  { key: 'assistant', href: '/admin/livraison/assistant', label: 'Assistant expédition' },
  { key: 'historique', href: '/admin/livraison/historique', label: 'Historique des coûts' },
  { key: 'tarif-analyse', href: '/admin/livraison/analyse-tarifaire', label: 'Analyse tarifaire' },
  { key: 'forfait-shadow', href: '/admin/livraison/forfait-shadow', label: 'Forfait' },
];

export function LivraisonTabs({ active }: { active: LivraisonTab }) {
  return <AdminTabs label="Navigation livraison" className="mb-5" tabs={TABS.map((tab) => ({ href: tab.href, label: tab.label, active: tab.key === active }))} />;
}
