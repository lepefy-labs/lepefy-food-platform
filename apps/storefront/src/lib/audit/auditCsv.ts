import { AUDIT_ACTOR_LABELS, AUDIT_CATEGORY_LABELS, AUDIT_RESOURCE_LABELS, auditFieldLabel } from './eventCatalog';
import type { AuditEventView } from './feedModel';
import type { SafeJson } from './sanitize';

/**
 * CSV of the journal: UTF-8 with BOM, `;`, CRLF (French Excel), every cell
 * quoted and formulas neutralised (CSV injection). Only events the admin may
 * read reach this function; the « Boutique » column exists only in the
 * platform view.
 */

export const OUTCOME_LABELS: Record<string, string> = { success: 'Réussi', failure: 'Échec', pending: 'En attente', unknown: 'À vérifier' };
export const SEVERITY_LABELS: Record<string, string> = { info: 'Info', notice: 'À noter', warning: 'Attention', critical: 'Critique' };

export function csvCell(value: unknown): string {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  const safe = /^[=+\-@\t\r|%]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function plain(value: SafeJson | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function changesText(event: Pick<AuditEventView, 'changes'>): string {
  return event.changes
    .map((change) => (change.redacted ? `${auditFieldLabel(change.field)} : modifié` : `${auditFieldLabel(change.field)} : ${plain(change.before)} → ${plain(change.after)}`))
    .join(' | ');
}

function localDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Rome' })
    .format(date).replace(',', '');
}

export function buildActivityCsv(events: AuditEventView[], options: { withTenant?: Map<string, string> } = {}): string {
  const header = ['Date', 'Événement', 'Module', 'Catégorie', 'Résultat', 'Gravité', 'Auteur', 'Type de ressource', 'Ressource',
    'Modifications', 'ID de corrélation', 'ID de l’événement', ...(options.withTenant ? ['Boutique'] : [])];
  const lines = events.map((event) => [
    localDateTime(event.occurredAt),
    event.label,
    event.moduleLabel,
    AUDIT_CATEGORY_LABELS[event.category],
    OUTCOME_LABELS[event.outcome] ?? event.outcome,
    SEVERITY_LABELS[event.severity] ?? event.severity,
    event.actorLabel ?? AUDIT_ACTOR_LABELS[event.actorType],
    event.resourceType ? (AUDIT_RESOURCE_LABELS[event.resourceType] ?? event.resourceType) : '',
    event.resourceLabel ?? event.resourceId ?? '',
    changesText(event),
    event.correlationId ?? '',
    event.id,
    ...(options.withTenant ? [event.tenantId ? (options.withTenant.get(event.tenantId) ?? event.tenantId) : 'Plateforme'] : []),
  ].map(csvCell).join(';'));
  return `﻿${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`;
}
