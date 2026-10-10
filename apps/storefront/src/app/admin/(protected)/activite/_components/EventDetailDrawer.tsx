'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { IconArrowRight, IconLink } from '@tabler/icons-react';
import type { AuditEventView } from '@/lib/audit/feedModel';
import { AUDIT_ACTOR_LABELS, AUDIT_CATEGORY_LABELS, AUDIT_RESOURCE_LABELS, auditDetailLabel, auditDetailValue } from '@/lib/audit/eventCatalog';
import type { SafeJson } from '@/lib/audit/sanitize';
import { formatDate } from '@/lib/admin/format';
import { AUDIT_OUTCOME_META, AUDIT_SEVERITY_META, statusMeta } from '@/lib/admin/statusRegistry';
import Badge from '../../../_components/ui/Badge';
import Button from '../../../_components/ui/Button';
import CopyableValue from '../../../_components/ui/CopyableValue';
import { Drawer } from '../../../_components/ui/Dialog';
import { DescriptionItem, DescriptionList } from '../../../_components/ui/Panel';
import AuditChanges from '../../../_components/data/AuditChanges';

const SOURCE_LABELS: Record<string, string> = {
  audit_events: 'Journal', business_audit_events: 'Historique Gestion', whatsapp_audit_events: 'Historique WhatsApp',
  assisted_order_events: 'Historique des précommandes', tenant_subscription_audit: 'Historique des abonnements',
  review_moderation_events: 'Modération des avis', external_catalog_events: 'Import de catalogues',
  event_capacity_adjustments: 'Capacité des événements', notification_deliveries: 'Envois de notifications',
  admin_access_audit: 'Ancien journal des accès',
};

function detailText(key: string, value: SafeJson): string {
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : auditDetailValue(key, String(item)))).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return auditDetailValue(key, String(value));
}

function metadataEntries(metadata: SafeJson): [string, string][] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => [auditDetailLabel(key), detailText(key, value)]);
}

/**
 * Detail of one event, opened by `?detail=<id>` (shareable link). The event was
 * re-read on the server inside the admin's tenant and modules; closing only
 * removes the parameter.
 */
export default function EventDetailDrawer({ event, closeHref, relatedHref, tenantName, notFound }: {
  event: AuditEventView | null;
  closeHref: string;
  relatedHref: string | null;
  tenantName?: string | null;
  notFound: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = Boolean(event) || notFound;
  const close = () => startTransition(() => router.replace(closeHref, { scroll: false }));
  const outcome = event ? statusMeta(AUDIT_OUTCOME_META, event.outcome) : null;
  const severity = event ? statusMeta(AUDIT_SEVERITY_META, event.severity) : null;
  const details = event ? metadataEntries(event.metadata) : [];

  return (
    <Drawer
      open={open}
      onClose={close}
      title={event?.label ?? 'Événement introuvable'}
      description={event ? formatDate(event.occurredAt, 'datetime') : undefined}
      footer={<Button onClick={close} disabled={pending}>Fermer</Button>}
    >
      {!event ? (
        <p className="text-sm text-a-text-2">Cet événement n’existe pas ou ne fait pas partie de votre périmètre.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {outcome && <Badge tone={outcome.tone} dot>{outcome.label}</Badge>}
            {severity && event.severity !== 'info' && <Badge tone={severity.tone}>{severity.label}</Badge>}
            <Badge tone="neutral">{AUDIT_CATEGORY_LABELS[event.category]}</Badge>
            <Badge tone="brand">{event.moduleLabel}</Badge>
          </div>

          <DescriptionList columns={1}>
            <DescriptionItem label="Auteur">
              {event.actorLabel ?? AUDIT_ACTOR_LABELS[event.actorType]}
              {event.actorLabel && event.actorType !== 'admin' && <span className="text-a-text-3"> · {AUDIT_ACTOR_LABELS[event.actorType]}</span>}
              {event.actorRef && <span className="block break-all font-mono text-xs text-a-text-3">{event.actorRef}</span>}
            </DescriptionItem>
            {event.resourceType && (
              <DescriptionItem label={AUDIT_RESOURCE_LABELS[event.resourceType] ?? 'Ressource'}>
                {event.resourceHref ? (
                  <Link href={event.resourceHref} className="inline-flex items-center gap-1 font-semibold text-a-brand-fg hover:underline">
                    {event.resourceLabel ?? 'Ouvrir'}<IconArrowRight size={14} aria-hidden="true" />
                  </Link>
                ) : (event.resourceLabel ?? <span className="font-mono text-xs">{event.resourceId}</span>)}
              </DescriptionItem>
            )}
            {tenantName !== undefined && <DescriptionItem label="Boutique">{tenantName ?? 'Plateforme'}</DescriptionItem>}
            <DescriptionItem label="Enregistré le">{formatDate(event.recordedAt, 'datetime')}</DescriptionItem>
            <DescriptionItem label="Origine">{SOURCE_LABELS[event.source] ?? event.source}</DescriptionItem>
          </DescriptionList>

          {event.changes.length > 0 && (
            <section aria-labelledby="audit-changes-title" className="space-y-2">
              <h3 id="audit-changes-title" className="text-sm font-semibold text-a-text">Modifications</h3>
              <AuditChanges changes={event.changes} />
            </section>
          )}

          {details.length > 0 && (
            <section aria-labelledby="audit-details-title" className="space-y-2">
              <h3 id="audit-details-title" className="text-sm font-semibold text-a-text">Détails</h3>
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {details.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-a-text-3">{key}</dt>
                    <dd className="break-words text-a-text">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section aria-label="Identifiants" className="space-y-1 text-sm">
            <CopyableValue label="ID" value={event.id} />
            {event.correlationId && <CopyableValue label="Corrélation" value={event.correlationId} />}
          </section>

          {relatedHref && (
            <Link href={relatedHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-a-brand-fg hover:underline">
              <IconLink size={16} aria-hidden="true" />Voir les événements de la même action
            </Link>
          )}
        </div>
      )}
    </Drawer>
  );
}
