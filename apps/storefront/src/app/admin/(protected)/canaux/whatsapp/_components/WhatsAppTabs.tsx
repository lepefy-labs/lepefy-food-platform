import { CountBadge } from '../../../../_components/ui/Badge';
import AdminTabs from '../../../../_components/ui/Tabs';

const TABS = [
  { href: '/admin/canaux/whatsapp', label: 'Vue d’ensemble', key: 'overview' },
  { href: '/admin/canaux/whatsapp/conversations', label: 'Conversations', key: 'conversations' },
  { href: '/admin/canaux/whatsapp/automatisations', label: 'Automatisations', key: 'automations' },
] as const;

export type WhatsAppTabKey = (typeof TABS)[number]['key'];

export default function WhatsAppTabs({ active, needsHumanCount = 0 }: { active: WhatsAppTabKey; needsHumanCount?: number }) {
  return (
    <AdminTabs
      label="Sections WhatsApp"
      className="mb-5"
      tabs={TABS.map((tab) => ({
        href: tab.href,
        label: tab.label,
        active: tab.key === active,
        badge: tab.key === 'conversations' ? <CountBadge tone="warning" count={needsHumanCount} label={`${needsHumanCount} en attente d’un humain`} /> : undefined,
      }))}
    />
  );
}
