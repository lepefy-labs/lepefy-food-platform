'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconArrowMerge, IconBrandGithub, IconCheck, IconChevronDown, IconExternalLink, IconLock, IconMessageCircle, IconNote, IconRefresh, IconTrash } from '@tabler/icons-react';
import { formatDate } from '@/lib/admin/format';
import { SUPPORT_PRIORITY_META, SUPPORT_STATUS_META, SUPPORT_TENANT_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import {
  SUPPORT_CATEGORY_LABELS, SUPPORT_CHANNEL_LABELS, SUPPORT_LINK_KIND_LABELS, SUPPORT_PRIORITIES, supportReference,
  type SupportCategory, type SupportPriority, type SupportStatus,
} from '@/lib/support/domain';
import { SUPPORT_TRANSITIONS, reopenTarget, tenantStatus } from '@/lib/support/rules';
import type { PlatformEvent, PlatformMessage, PlatformTicketDetail } from '@/lib/support/types';
import { cn } from '@/lib/utils/cn';
import Badge from '../../../../_components/ui/Badge';
import Button from '../../../../_components/ui/Button';
import ConfirmDialog from '../../../../_components/ui/ConfirmDialog';
import { Input, Select, labelClasses } from '../../../../_components/ui/Form';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { useAdminToast } from '../../../../_components/ui/Toaster';
import SupportImage from '../../../../_components/support/SupportImage';
import ThreadComposer from '../../../../_components/support/ThreadComposer';
import { supportFetch } from '../../../../_components/support/supportClient';

const REFRESH_MS = 45_000;
const API = '/api/admin/platform/assistance';

const EVENT_LABELS: Record<string, string> = {
  created: 'Demande créée depuis l’administration',
  imported: 'Demande saisie par Lepefy',
  status_changed: 'Statut',
  priority_changed: 'Priorité',
  assigned: 'Assignation',
  category_changed: 'Catégorie',
  visibility_changed: 'Visibilité boutique',
  title_changed: 'Titre modifié',
  merged_into: 'Fusionnée dans',
  merged_from: 'Demande fusionnée ici',
  link_added: 'Lien GitHub ajouté',
  link_removed: 'Lien GitHub retiré',
  tenant_feedback: 'Avis de la boutique',
  reopened: 'Rouverte',
};

function eventValue(event: PlatformEvent, people: Record<string, string>): string {
  const label = (value: string | null) => {
    if (!value) return '—';
    if (event.event_type === 'status_changed' || event.event_type === 'reopened') return SUPPORT_STATUS_META[value]?.label ?? value;
    if (event.event_type === 'priority_changed') return SUPPORT_PRIORITY_META[value]?.label ?? value;
    if (event.event_type === 'category_changed') return SUPPORT_CATEGORY_LABELS[value as SupportCategory] ?? value;
    if (event.event_type === 'assigned') return people[value] ?? 'Lepefy';
    if (event.event_type === 'visibility_changed') return value === 'true' ? 'visible' : 'masquée';
    if (event.event_type === 'tenant_feedback') return value === 'solved' ? 'problème résolu' : 'problème non résolu';
    if (event.event_type === 'merged_into' || event.event_type === 'merged_from') return supportReference(value);
    if (event.event_type === 'created' || event.event_type === 'imported') return SUPPORT_CHANNEL_LABELS[value as keyof typeof SUPPORT_CHANNEL_LABELS] ?? value;
    if (event.event_type === 'link_added' || event.event_type === 'link_removed') return SUPPORT_LINK_KIND_LABELS[value as keyof typeof SUPPORT_LINK_KIND_LABELS] ?? value;
    return value;
  };
  if (event.from_value && event.to_value) return `${label(event.from_value)} → ${label(event.to_value)}`;
  return event.to_value ? label(event.to_value) : event.from_value ? label(event.from_value) : '';
}

type Item = { kind: 'message'; at: string; message: PlatformMessage } | { kind: 'event'; at: string; event: PlatformEvent };

function SidePanel({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-[10px] border border-a-border bg-a-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-a-text hover:bg-a-hover [&::-webkit-details-marker]:hidden">
        {title}<IconChevronDown size={16} aria-hidden="true" className="text-a-text-3 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-a-border px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
      <dt className="text-xs text-a-text-3">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-a-text">{children}</dd>
    </div>
  );
}

/**
 * Platform view of one request: full conversation with internal notes
 * (never sent to the shop), workflow and context on the side, panels folding
 * under the conversation on a phone.
 */
export default function PlatformTicketClient({ initialDetail, owners, currentAdminId }: {
  initialDetail: PlatformTicketDetail;
  owners: Array<{ id: string; label: string }>;
  currentAdminId: string | null;
}) {
  const toast = useAdminToast();
  const [detail, setDetail] = useState(initialDetail);
  const [mode, setMode] = useState<'message' | 'internal_note'>('message');
  const [waitForTenant, setWaitForTenant] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<SupportStatus | ''>('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const ticket = detail.ticket;
  const id = ticket.id;

  const items = useMemo<Item[]>(() => [
    ...detail.messages.map((message) => ({ kind: 'message' as const, at: message.created_at, message })),
    ...detail.events.filter((event) => event.event_type !== 'created').map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [detail]);

  const markRead = useCallback(() => { void fetch(`${API}/tickets/${id}/read`, { method: 'POST' }).catch(() => {}); }, [id]);
  useEffect(() => { markRead(); }, [markRead]);

  const reload = useCallback(async () => {
    try {
      const data = await supportFetch<{ detail: PlatformTicketDetail }>(`${API}/tickets/${id}`);
      setDetail((current) => {
        if (data.detail.ticket.last_tenant_message_at !== current.ticket.last_tenant_message_at) markRead();
        return data.detail;
      });
    } catch { /* next tick */ }
  }, [id, markRead]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function mutate(key: string, url: string, init: { method?: string; body?: unknown }, success?: string): Promise<boolean> {
    setBusy(key);
    try {
      const data = await supportFetch<{ detail: PlatformTicketDetail | null }>(url, init);
      if (data.detail) setDetail(data.detail);
      if (success) toast.success(success);
      return true;
    } catch (caught) {
      toast.error((caught as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (to: SupportStatus, success: string) => mutate(`status:${to}`, `${API}/tickets/${id}`, { method: 'PATCH', body: { status: to, expectedStatus: ticket.status } }, success);
  const patch = (body: Record<string, unknown>, success: string) => mutate(`patch:${Object.keys(body)[0]}`, `${API}/tickets/${id}`, { method: 'PATCH', body }, success);

  async function send(input: { text: string; attachmentIds: string[]; clientKey: string }) {
    const data = await supportFetch<{ detail: PlatformTicketDetail | null }>(`${API}/tickets/${id}/messages`, {
      body: { ...input, kind: mode, waitForTenant: mode === 'message' && waitForTenant },
    });
    if (data.detail) setDetail(data.detail);
    setWaitForTenant(false);
    toast.success(mode === 'internal_note' ? 'Note interne ajoutée.' : 'Réponse envoyée à la boutique.');
  }

  async function addLink() {
    setLinkError(null);
    const ok = await mutate('link', `${API}/tickets/${id}/links`, { body: { url: linkUrl } }, 'Lien ajouté.');
    if (ok) setLinkUrl('');
    else setLinkError('Lien refusé : collez l’adresse d’une issue, pull request, commit ou release GitHub.');
  }

  async function merge() {
    setMergeError(null);
    setBusy('merge');
    try {
      const data = await supportFetch<{ detail: PlatformTicketDetail | null }>(`${API}/tickets/${id}/merge`, { body: { targetNumber: mergeTarget } });
      if (data.detail) setDetail(data.detail);
      setMergeOpen(false);
      setMergeTarget('');
      toast.success('Demandes fusionnées.');
    } catch (caught) {
      setMergeError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const status = statusMeta(SUPPORT_STATUS_META, ticket.status);
  const priority = statusMeta(SUPPORT_PRIORITY_META, ticket.priority);
  const shopSees = statusMeta(SUPPORT_TENANT_STATUS_META, tenantStatus(ticket.status));
  const finished = ticket.status === 'resolved' || ticket.status === 'closed';
  const reopenTo = reopenTarget(ticket.status);
  const merged = Boolean(ticket.merged_into_ticket_id);
  const context = ticket.context ?? {};
  const people = detail.people;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-xl font-semibold text-a-text sm:text-2xl">{supportReference(ticket.number)} · {ticket.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-a-text-2">
            <span className="font-semibold text-a-text">{ticket.tenant_name}</span>
            <Badge tone={status.tone} dot>{status.label}</Badge>
            <Badge tone={priority.tone}>Priorité {priority.label.toLowerCase()}</Badge>
            {ticket.declared_urgent && <Badge tone="urgent">Urgent déclaré</Badge>}
            {ticket.awaiting_lepefy && <Badge tone={ticket.stale ? 'danger' : 'warning'}>{ticket.stale ? 'Sans réponse depuis plus de 24 h' : 'À répondre'}</Badge>}
            <span className="text-xs text-a-text-3">La boutique voit « {shopSees.label} »</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!finished && !merged && <Button onClick={() => void setStatus('resolved', 'Demande marquée résolue : la boutique peut confirmer.')} loading={busy === 'status:resolved'}><IconCheck size={16} aria-hidden="true" />Marquer résolue</Button>}
          {ticket.status === 'resolved' && <Button variant="secondary" onClick={() => void setStatus('closed', 'Demande clôturée.')} loading={busy === 'status:closed'}>Clôturer</Button>}
          {reopenTo && !merged && <Button variant="secondary" onClick={() => void setStatus(reopenTo, 'Demande rouverte.')} loading={busy === `status:${reopenTo}`}><IconRefresh size={16} aria-hidden="true" />Rouvrir</Button>}
        </div>
      </header>

      {merged && detail.mergedInto && (
        <InlineAlert tone="info" title={`Fusionnée dans la demande ${supportReference(detail.mergedInto.number)}.`}
          action={<a href={`/admin/platform/assistance/${detail.mergedInto.id}`} className="text-sm font-semibold text-a-brand-fg underline underline-offset-2">Ouvrir</a>} />
      )}
      {!ticket.visible_to_tenant && <InlineAlert tone="warning" title="Cette demande n’est pas visible par la boutique.">Rendez-la visible dans « Traitement » pour que la boutique puisse la suivre et répondre.</InlineAlert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <ol className="space-y-3" aria-label="Conversation">
            {items.map((item) => {
              if (item.kind === 'event') {
                const event = item.event;
                return (
                  <li key={event.id} className="flex justify-center">
                    <span className="inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full bg-a-surface-2 px-3 py-1 text-center text-xs text-a-text-2">
                      {!event.public && <IconLock size={12} aria-label="Interne" />}
                      <span className="font-semibold">{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                      {eventValue(event, people) && <span>{eventValue(event, people)}</span>}
                      <span className="text-a-text-3">· {event.actor_admin_id ? people[event.actor_admin_id] ?? (event.actor_type === 'tenant' ? 'Boutique' : 'Lepefy') : event.actor_type === 'tenant' ? 'Boutique' : 'Lepefy'} · {formatDate(event.created_at, 'short')}</span>
                    </span>
                  </li>
                );
              }
              const message = item.message;
              const note = message.kind === 'internal_note';
              const fromShop = message.author_type === 'tenant';
              const author = message.author_admin_id ? people[message.author_admin_id] ?? message.author_label : message.author_label;
              return (
                <li key={message.id} className={cn('flex', fromShop ? 'justify-start' : 'justify-end', note && 'justify-stretch')}>
                  <article className={cn('space-y-1.5 rounded-2xl px-3.5 py-2.5',
                    note ? 'w-full border border-dashed border-tone-warning-border bg-tone-warning-bg'
                      : fromShop ? 'max-w-[88%] rounded-bl-md border border-a-border bg-a-surface sm:max-w-[78%]'
                        : 'max-w-[88%] rounded-br-md bg-a-brand-soft sm:max-w-[78%]')}>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-a-text-2">
                      {note && <><IconLock size={13} aria-hidden="true" />Note interne — invisible pour la boutique ·</>}
                      {message.relayed_from
                        ? <>Reçu par {SUPPORT_CHANNEL_LABELS[message.relayed_from]}{ticket.requester_label ? ` de ${ticket.requester_label}` : ''}{message.original_sent_at ? ` le ${formatDate(message.original_sent_at, 'datetime')}` : ''} · saisi par {author ?? 'Lepefy'}</>
                        : fromShop ? <>{author ?? 'Boutique'} · {ticket.tenant_name}</> : <>{author ?? 'Lepefy'} · Équipe Lepefy</>}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-a-text">{message.body}</p>
                    {message.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {message.attachments.map((file, index) => (
                          <SupportImage key={file.id} src={`${API}/attachments/${file.id}`} width={file.width} height={file.height} label={`Capture ${index + 1}`} />
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-a-text-3"><time dateTime={message.created_at}>{formatDate(message.created_at, 'datetime')}</time></p>
                  </article>
                </li>
              );
            })}
          </ol>

          {!merged && (
            <div className="space-y-3 rounded-[10px] border border-a-border bg-a-surface p-3 sm:p-4">
              <div role="tablist" aria-label="Type de message" className="flex gap-1 border-b border-a-border">
                {([['message', 'Répondre à la boutique', IconMessageCircle], ['internal_note', 'Note interne', IconNote]] as const).map(([key, label, Icon]) => (
                  <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}
                    className={cn('-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold', mode === key ? 'border-a-brand text-a-brand-fg' : 'border-transparent text-a-text-2 hover:text-a-text')}>
                    <Icon size={16} aria-hidden="true" />{label}
                  </button>
                ))}
              </div>
              {mode === 'internal_note' && <p className="flex items-center gap-1.5 text-xs text-tone-warning-fg"><IconLock size={14} aria-hidden="true" />Visible uniquement par Lepefy. Jamais envoyée ni notifiée à la boutique.</p>}
              {mode === 'message' && !ticket.visible_to_tenant && <p className="text-xs text-tone-warning-fg">La boutique ne verra cette réponse qu’une fois la demande rendue visible.</p>}
              <ThreadComposer key={mode} onSend={send} uploadEndpoint={`${API}/attachments`} uploadExtra={{ tenantId: ticket.tenant_id }}
                tone={mode === 'internal_note' ? 'note' : 'default'}
                label={mode === 'internal_note' ? 'Note interne' : 'Réponse à la boutique'}
                placeholder={mode === 'internal_note' ? 'Diagnostic, piste, lien… (interne)' : 'Votre réponse à la boutique…'}
                submitLabel={mode === 'internal_note' ? 'Ajouter la note' : 'Envoyer la réponse'}>
                {mode === 'message' && !finished && (
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-a-text">
                    <input type="checkbox" checked={waitForTenant} onChange={(event) => setWaitForTenant(event.target.checked)} className="h-4 w-4 rounded border-a-field accent-a-brand" />
                    J’attends une réponse de la boutique
                  </label>
                )}
              </ThreadComposer>
            </div>
          )}
        </div>

        <aside className="space-y-3" aria-label="Traitement et contexte">
          <SidePanel title="Traitement">
            <div>
              <label className={labelClasses} htmlFor="support-status">Statut</label>
              <div className="flex gap-2">
                <Select id="support-status" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as SupportStatus | '')} disabled={merged}>
                  <option value="">{status.label} (actuel)</option>
                  {SUPPORT_TRANSITIONS[ticket.status].map((value) => <option key={value} value={value}>{SUPPORT_STATUS_META[value]?.label ?? value}</option>)}
                </Select>
                <Button variant="secondary" disabled={!nextStatus} loading={busy?.startsWith('status:')}
                  onClick={() => { if (nextStatus) void setStatus(nextStatus, 'Statut mis à jour.').then((ok) => { if (ok) setNextStatus(''); }); }}>OK</Button>
              </div>
            </div>
            <div>
              <label className={labelClasses} htmlFor="support-priority">Priorité</label>
              <Select id="support-priority" value={ticket.priority} disabled={busy === 'patch:priority'} onChange={(event) => void patch({ priority: event.target.value as SupportPriority }, 'Priorité mise à jour.')}>
                {SUPPORT_PRIORITIES.map((value) => <option key={value} value={value}>{SUPPORT_PRIORITY_META[value]?.label}</option>)}
              </Select>
              {ticket.declared_urgent && <p className="mt-1 text-xs text-a-text-3">La boutique a coché « C’est urgent ».</p>}
            </div>
            <div>
              <label className={labelClasses} htmlFor="support-assignee">Assignée à</label>
              <Select id="support-assignee" value={ticket.assignee_admin_id ?? 'none'} disabled={busy === 'patch:assignee'} onChange={(event) => void patch({ assignee: event.target.value }, 'Assignation mise à jour.')}>
                <option value="none">Personne</option>
                {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.label}{owner.id === currentAdminId ? ' (moi)' : ''}</option>)}
              </Select>
            </div>
            <div>
              <label className={labelClasses} htmlFor="support-category">Catégorie</label>
              <Select id="support-category" value={ticket.category} disabled={busy === 'patch:category'} onChange={(event) => void patch({ category: event.target.value }, 'Catégorie mise à jour.')}>
                {Object.entries(SUPPORT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </div>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-a-text">
              <input type="checkbox" checked={ticket.visible_to_tenant} disabled={busy === 'patch:visible'}
                onChange={(event) => void patch({ visible: event.target.checked }, event.target.checked ? 'Demande visible par la boutique.' : 'Demande masquée pour la boutique.')}
                className="h-4 w-4 rounded border-a-field accent-a-brand" />
              Visible par la boutique
            </label>
          </SidePanel>

          <SidePanel title="Contexte">
            <dl className="space-y-2">
              <Fact label="Boutique">{ticket.tenant_name}</Fact>
              <Fact label="Demandeur">{ticket.requester_admin_id ? people[ticket.requester_admin_id] ?? ticket.requester_label ?? '—' : ticket.requester_label ?? '—'}</Fact>
              <Fact label="Origine">{ticket.origin === 'platform_manual' ? `Saisie Lepefy · ${SUPPORT_CHANNEL_LABELS[ticket.source_channel]}` : 'Administration de la boutique'}</Fact>
              {ticket.external_reference && <Fact label="Référence externe">{ticket.external_reference}</Fact>}
              {context.page_label && <Fact label="Page">{context.page_label}</Fact>}
              {context.route && <Fact label="Route"><code className="text-xs">{context.route}</code></Fact>}
              {ticket.resource_label && <Fact label="Ressource">{ticket.resource_label}</Fact>}
              {(context.device || context.os) && <Fact label="Appareil">{[context.device === 'mobile' ? 'Mobile' : context.device === 'tablet' ? 'Tablette' : context.device === 'desktop' ? 'Ordinateur' : null, context.os, context.browser].filter(Boolean).join(' · ')}</Fact>}
              {context.viewport && <Fact label="Écran">{context.viewport}</Fact>}
              {context.locale && <Fact label="Langue">{context.locale}</Fact>}
              {context.app_version && <Fact label="Version"><code className="text-xs">{context.app_version}</code></Fact>}
            </dl>
          </SidePanel>

          <SidePanel title="Dates" defaultOpen={false}>
            <dl className="space-y-2">
              <Fact label="Demande">{formatDate(ticket.reported_at, 'datetime')}</Fact>
              {ticket.reported_at !== ticket.created_at && <Fact label="Saisie">{formatDate(ticket.created_at, 'datetime')}</Fact>}
              <Fact label="Première réponse">{ticket.first_response_at ? formatDate(ticket.first_response_at, 'datetime') : '—'}</Fact>
              <Fact label="Dernier message boutique">{ticket.last_tenant_message_at ? formatDate(ticket.last_tenant_message_at, 'datetime') : '—'}</Fact>
              <Fact label="Résolue">{ticket.resolved_at ? formatDate(ticket.resolved_at, 'datetime') : '—'}</Fact>
              <Fact label="Clôturée">{ticket.closed_at ? formatDate(ticket.closed_at, 'datetime') : '—'}</Fact>
              {ticket.reopen_count > 0 && <Fact label="Réouvertures">{ticket.reopen_count}</Fact>}
              {ticket.tenant_feedback && <Fact label="Avis boutique">{ticket.tenant_feedback === 'solved' ? 'Résolu' : 'Non résolu'}</Fact>}
            </dl>
          </SidePanel>

          <SidePanel title="GitHub" defaultOpen={detail.links.length > 0}>
            {detail.links.length > 0 ? (
              <ul className="space-y-2">
                {detail.links.map((link) => (
                  <li key={link.id} className="flex items-center gap-2">
                    <IconBrandGithub size={16} aria-hidden="true" className="shrink-0 text-a-text-3" />
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-a-brand-fg hover:underline">
                      {SUPPORT_LINK_KIND_LABELS[link.kind]} · {link.label ?? link.url}<IconExternalLink size={12} aria-hidden="true" className="ml-1 inline" />
                    </a>
                    <button type="button" aria-label={`Retirer le lien ${link.label ?? link.url}`} onClick={() => void mutate('unlink', `${API}/tickets/${id}/links?linkId=${link.id}`, { method: 'DELETE' }, 'Lien retiré.')}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-a-text-3 hover:bg-a-hover hover:text-tone-danger-fg"><IconTrash size={15} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-a-text-3">Aucun lien. Le suivi technique n’apparaît jamais à la boutique.</p>}
            <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void addLink(); }}>
              <label className="sr-only" htmlFor="support-link">Adresse GitHub</label>
              <Input id="support-link" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://github.com/…/pull/821" inputMode="url" />
              {linkError && <p className="text-xs text-tone-danger-fg" role="alert">{linkError}</p>}
              <Button type="submit" size="sm" variant="secondary" disabled={!linkUrl.trim()} loading={busy === 'link'}>Lier</Button>
            </form>
            <p className="text-xs text-a-text-3">Une PR fusionnée ne clôt pas la demande : marquez-la résolue une fois le correctif en production.</p>
          </SidePanel>

          <SidePanel title="Doublon" defaultOpen={false}>
            {detail.mergedFrom.length > 0 && <p className="text-a-text-2">Regroupe : {detail.mergedFrom.map((item) => supportReference(item.number)).join(', ')}</p>}
            {!merged ? (
              <Button variant="secondary" size="sm" onClick={() => setMergeOpen(true)}><IconArrowMerge size={16} aria-hidden="true" />Fusionner dans une autre demande…</Button>
            ) : <p className="text-a-text-3">Déjà fusionnée.</p>}
          </SidePanel>
        </aside>
      </div>

      <ConfirmDialog
        open={mergeOpen}
        title={`Fusionner ${supportReference(ticket.number)} dans une autre demande`}
        description="Cette demande sera clôturée et renverra vers la demande conservée, de la même boutique. Les deux historiques gardent la trace de la fusion."
        confirmLabel="Fusionner"
        loading={busy === 'merge'}
        confirmDisabled={!/^\d{1,12}$/.test(mergeTarget.replace(/^#|^n°\s*/i, '').trim())}
        error={mergeError}
        onConfirm={() => void merge()}
        onCancel={() => { setMergeOpen(false); setMergeError(null); }}
      >
        <label className={labelClasses} htmlFor="support-merge-target">Numéro de la demande à conserver</label>
        <Input id="support-merge-target" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)} inputMode="numeric" placeholder="1031" />
      </ConfirmDialog>
    </div>
  );
}
