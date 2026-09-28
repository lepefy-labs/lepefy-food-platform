import Link from 'next/link';
import { IconBrandStripe, IconChevronRight, IconMail, IconPackage, IconPlugConnected, IconRoute, IconWallet, type Icon } from '@tabler/icons-react';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { SettingsStatusBadge } from '../_components/SettingsUi';
import { loadIntegrationStatuses, type IntegrationStatus } from '../_components/integrationsStatus';
import type { SettingsStatus } from '../_components/settingsRegistry';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ICONS: Record<IntegrationStatus['key'], Icon> = {
  stripe: IconBrandStripe,
  packlink: IconPackage,
  n8n: IconRoute,
  brevo: IconMail,
  wallet: IconWallet,
};

function toStatus(item: IntegrationStatus): SettingsStatus {
  const tone = item.state === 'connected' || item.state === 'configured' ? 'ok' : item.state === 'missing' ? 'warning' : 'neutral';
  return { label: item.stateLabel, tone };
}

export default async function ParametresIntegrationsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const integrations = loadIntegrationStatuses(tenant);
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canOpen = (item: IntegrationStatus) => Boolean(item.manageHref && (!item.managePermission || (access && canAdmin(access, item.managePermission))));

  return (
    <SettingsPageShell sectionKey="integrations" description="Services externes utilisés par votre boutique. Les clés et secrets ne sont jamais affichés.">
      <ul className="grid gap-4 md:grid-cols-2">
        {integrations.map((item) => {
          const ItemIcon = ICONS[item.key] ?? IconPlugConnected;
          return (
            <li key={item.key} id={item.key} className="scroll-mt-24">
              <article aria-labelledby={`${item.key}-title`} className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"><ItemIcon size={20} stroke={1.7} aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <h2 id={`${item.key}-title`} className="text-base font-semibold text-gray-950 dark:text-gray-100">{item.name}</h2>
                      <SettingsStatusBadge status={toStatus(item)} />
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.description}</p>
                  </div>
                </div>
                <ul className="mt-4 flex-1 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
                  {item.details.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
                {canOpen(item) && item.manageHref && (
                  <Link href={item.manageHref} className="-mx-2 mt-3 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-sm font-medium text-[var(--admin-primary-fg)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:text-violet-300">
                    {item.manageLabel}<IconChevronRight size={16} aria-hidden="true" />
                  </Link>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </SettingsPageShell>
  );
}
