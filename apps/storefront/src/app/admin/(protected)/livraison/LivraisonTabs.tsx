import Link from 'next/link';

type LivraisonTab =
  | 'rules' | 'packaging' | 'laboratoire' | 'assistant' | 'historique' | 'tarif-analyse' | 'forfait-shadow' | 'packlink-diagnostic';

const TABS: Array<{ key: LivraisonTab; href: string; label: string }> = [
  { key: 'rules', href: '/admin/livraison', label: 'Tarification' },
  { key: 'packaging', href: '/admin/livraison/emballages', label: 'Emballages' },
  { key: 'laboratoire', href: '/admin/livraison/laboratoire', label: 'Laboratoire' },
  { key: 'assistant', href: '/admin/livraison/assistant', label: 'Assistant expédition' },
  { key: 'historique', href: '/admin/livraison/historique', label: 'Historique des coûts' },
  { key: 'tarif-analyse', href: '/admin/livraison/analyse-tarifaire', label: 'Analyse tarifaire' },
  { key: 'forfait-shadow', href: '/admin/livraison/forfait-shadow', label: 'Forfait' },
  { key: 'packlink-diagnostic', href: '/admin/livraison/diagnostic-packlink', label: 'Diagnostic Packlink' },
];

const TAB_CLS =
  'inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl px-3.5 py-2 text-center text-sm font-medium transition-colors';
const TAB_ACTIVE =
  'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]';
const TAB_INACTIVE =
  'text-gray-500 hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100';

export function LivraisonTabs({ active }: { active: LivraisonTab }) {
  return (
    <nav
      aria-label="Navigation livraison"
      className="mb-5 flex w-full gap-1 overflow-x-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] p-1.5 sm:w-fit"
    >
      {TABS.map((tab) =>
        tab.key === active ? (
          <span key={tab.key} aria-current="page" className={`${TAB_CLS} ${TAB_ACTIVE}`}>
            {tab.label}
          </span>
        ) : (
          <Link key={tab.key} href={tab.href} className={`${TAB_CLS} ${TAB_INACTIVE}`}>
            {tab.label}
          </Link>
        ),
      )}
    </nav>
  );
}
