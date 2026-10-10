import Link from 'next/link';
import { IconArrowRight } from '@tabler/icons-react';
import type { Tenant } from '@lepefy/types';
import { resourceTimelineScope } from '@/lib/audit/access';
import { ACTIVITY_LIST } from '@/lib/audit/activityListParams';
import { AUDIT_ACTOR_LABELS } from '@/lib/audit/eventCatalog';
import { buildFeedFilters, loadFeedPage, type AuditEventView } from '@/lib/audit/feed';
import { formatDate } from '@/lib/admin/format';
import { cn } from '@/lib/utils/cn';
import { TONE_SOLID_BG_CLASS } from '../ui/Badge';
import { Panel } from '../ui/Panel';
import AuditChanges from './AuditChanges';

interface ResourceActivityProps {
  tenant: Tenant;
  /** Permission of the host page (e.g. orders.view on the order detail). */
  hostPermission: string;
  /** One resource… */
  resourceType?: string;
  resourceId?: string;
  /** …or the latest events of one module (e.g. `admin` on the settings hub). */
  module?: string;
  title?: string;
  limit?: number;
}

function dotClass(event: AuditEventView): string {
  if (event.outcome === 'failure') return TONE_SOLID_BG_CLASS.danger;
  if (event.outcome === 'unknown' || event.severity === 'critical') return TONE_SOLID_BG_CLASS.warning;
  if (event.category === 'automation') return TONE_SOLID_BG_CLASS.neutral;
  return 'bg-a-brand';
}

/**
 * Contextual history of a resource from the Journal d'activité. Server
 * Component: renders nothing when the journal is not open to this admin, when
 * the host permission is missing or when the journal cannot be read (the host
 * page never fails because of it). Admin-only, never on customer pages.
 */
export default async function ResourceActivity({ tenant, hostPermission, resourceType, resourceId, module, title = 'Historique', limit = 15 }: ResourceActivityProps) {
  const scope = await resourceTimelineScope(tenant, hostPermission);
  if (!scope) return null;
  let events: AuditEventView[];
  try {
    events = await loadFeedPage(buildFeedFilters(scope, { tenantIds: [tenant.id] }, {
      categories: scope.categories.filter((category) => category !== 'security'),
      resourceType, resourceId, modules: module ? [module] : undefined,
    }), limit + 1);
  } catch {
    return null;
  }
  const more = events.length > limit;
  const shown = events.slice(0, limit);
  const journalHref = ACTIVITY_LIST.href('/admin/activite', ACTIVITY_LIST.parse({}), {
    period: '730d',
    ...(resourceType && resourceId ? { rt: resourceType, rid: resourceId } : {}),
    ...(module ? { module } : {}),
  });

  return (
    <Panel
      title={title}
      description="Actions et automatisations enregistrées dans le journal d’activité."
      actions={<Link href={journalHref} className="inline-flex items-center gap-1 text-sm font-semibold text-a-brand-fg hover:underline">
        {more ? 'Tout voir' : 'Ouvrir le journal'}<IconArrowRight size={14} aria-hidden="true" />
      </Link>}
    >
      {shown.length === 0 ? (
        <p className="text-sm text-a-text-3">Aucun événement enregistré pour le moment.</p>
      ) : (
        <ol className="space-y-3">
          {shown.map((event) => (
            <li key={event.id} className="flex gap-3">
              <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dotClass(event))} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-a-text">
                  <Link href={ACTIVITY_LIST.href('/admin/activite', ACTIVITY_LIST.parse({}), { period: '730d', tab: event.category === 'automation' ? 'automation' : 'activity', detail: event.id })} className="hover:underline">
                    {event.label}
                  </Link>
                  {event.outcome === 'failure' && <span className="text-tone-danger-fg"> · échec</span>}
                </p>
                <AuditChanges changes={event.changes.slice(0, 3)} compact />
                <p className="text-xs text-a-text-3">
                  <time dateTime={event.occurredAt}>{formatDate(event.occurredAt, 'datetime')}</time>
                  {' · '}{event.actorLabel ?? AUDIT_ACTOR_LABELS[event.actorType]}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
