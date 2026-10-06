import Link from 'next/link';

const TABS = [
  { href: '/admin/canaux/whatsapp', label: 'Vue d’ensemble', key: 'overview' },
  { href: '/admin/canaux/whatsapp/conversations', label: 'Conversations', key: 'conversations' },
  { href: '/admin/canaux/whatsapp/automatisations', label: 'Automatisations', key: 'automations' },
] as const;

export type WhatsAppTabKey = (typeof TABS)[number]['key'];

export default function WhatsAppTabs({ active, needsHumanCount = 0 }: { active: WhatsAppTabKey; needsHumanCount?: number }) {
  return (
    <nav aria-label="Sections WhatsApp" className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--admin-border)] dark:border-gray-800">
      {TABS.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${current
              ? 'border-[var(--admin-primary)] font-semibold text-gray-950 dark:text-white'
              : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`}
          >
            {tab.label}
            {tab.key === 'conversations' && needsHumanCount > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{needsHumanCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
