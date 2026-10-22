'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconCircleCheck, IconLifebuoy, IconMapPin, IconPlus } from '@tabler/icons-react';
import { formatDate } from '@/lib/admin/format';
import { SUPPORT_TENANT_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import { SUPPORT_CATEGORY_LABELS, SUPPORT_CHANNEL_LABELS, supportReference } from '@/lib/support/domain';
import type { TenantThread, TenantThreadEvent, TenantThreadMessage } from '@/lib/support/types';
import { cn } from '@/lib/utils/cn';
import Badge from '../../../_components/ui/Badge';
import Button from '../../../_components/ui/Button';
import InlineAlert from '../../../_components/ui/InlineAlert';
import SupportImage from '../../../_components/support/SupportImage';
import ThreadComposer from '../../../_components/support/ThreadComposer';
import { SupportOpenButton } from '../../../_components/support/SupportHeaderButton';
import { supportFetch } from '../../../_components/support/supportClient';

const REFRESH_MS = 45_000;

type Item = { kind: 'message'; at: string; message: TenantThreadMessage } | { kind: 'event'; at: string; event: TenantThreadEvent };

function eventText(event: TenantThreadEvent): string | null {
  if (event.event_type === 'status_changed' || event.event_type === 'reopened') {
    const label = event.to_tenant_status ? SUPPORT_TENANT_STATUS_META[event.to_tenant_status]?.label : null;
    if (!label) return null;
    return event.event_type === 'reopened' ? `Demande rouverte · ${label}` : `Statut : ${label}`;
  }
  if (event.event_type === 'tenant_feedback') return event.value === 'solved' ? 'Vous avez confirmé que le problème est résolu.' : 'Vous avez indiqué que le problème persiste.';
  if (event.event_type === 'merged_into') return `Demande regroupée avec la demande ${supportReference(event.value ?? '')}.`;
  if (event.event_type === 'merged_from') return `La demande ${supportReference(event.value ?? '')} a été regroupée ici.`;
  return null;
}

/**
 * Shop conversation: your messages on the right, the Lepefy team on the left,
 * status changes in the middle. Refreshed every 45 s while the tab is visible
 * (no websocket); the composer only shows a message once it is saved.
 */
export default function ConversationClient({ initialThread, readOnly }: { initialThread: TenantThread; readOnly: boolean }) {
  const router = useRouter();
  const [thread, setThread] = useState(initialThread);
  const [feedbackBusy, setFeedbackBusy] = useState<boolean | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [writeAnyway, setWriteAnyway] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const firstUnreadAt = useRef(initialThread.ticket.last_read_at);
  const latestLepefyAt = useRef<string | null>(null);
  const id = thread.ticket.id;

  const items = useMemo<Item[]>(() => [
    ...thread.messages.map((message) => ({ kind: 'message' as const, at: message.created_at, message })),
    ...thread.events.filter((event) => eventText(event)).map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [thread]);

  const lastLepefy = thread.messages.filter((message) => message.author_type === 'lepefy').slice(-1)[0]?.created_at ?? null;

  const markRead = useCallback(async (refresh: boolean) => {
    if (readOnly) return;
    await fetch(`/api/admin/assistance/tickets/${id}/read`, { method: 'POST' }).catch(() => {});
    if (refresh) router.refresh();
  }, [id, readOnly, router]);

  // Opened: read, and the menu badge follows.
  useEffect(() => {
    const unread = !initialThread.ticket.last_read_at || initialThread.ticket.last_activity_at > initialThread.ticket.last_read_at;
    latestLepefyAt.current = lastLepefy;
    void markRead(unread);
    endRef.current?.scrollIntoView({ block: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await supportFetch<{ thread: TenantThread }>(`/api/admin/assistance/tickets/${id}`);
      setThread(data.thread);
      const newest = data.thread.messages.filter((message) => message.author_type === 'lepefy').slice(-1)[0]?.created_at ?? null;
      if (newest && newest !== latestLepefyAt.current) {
        latestLepefyAt.current = newest;
        void markRead(true);
        window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 50);
      }
    } catch { /* next tick */ }
  }, [id, markRead]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload]);

  async function send(input: { text: string; attachmentIds: string[]; clientKey: string }) {
    const data = await supportFetch<{ thread: TenantThread | null }>(`/api/admin/assistance/tickets/${id}/messages`, { body: input });
    if (data.thread) setThread(data.thread);
    window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 50);
  }

  async function feedback(solved: boolean) {
    setFeedbackBusy(solved);
    setFeedbackError(null);
    try {
      const data = await supportFetch<{ thread: TenantThread | null }>(`/api/admin/assistance/tickets/${id}/feedback`, { body: { solved } });
      if (data.thread) setThread(data.thread);
    } catch (caught) {
      setFeedbackError((caught as Error).message);
    } finally {
      setFeedbackBusy(null);
    }
  }

  const ticket = thread.ticket;
  const status = statusMeta(SUPPORT_TENANT_STATUS_META, ticket.tenant_status);
  const closed = ticket.tenant_status === 'done' && ticket.status_detail !== 'resolved';
  const askFeedback = ticket.status_detail === 'resolved' && !ticket.tenant_feedback && !readOnly;
  const merged = ticket.merged_into_number;
  let dividerShown = false;

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <header className="space-y-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="min-w-0 text-xl font-semibold text-a-text sm:text-2xl">{ticket.title}</h1>
          <Badge tone={status.tone} dot>{status.label}</Badge>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-a-text-3">
          <span>{supportReference(ticket.number)}</span>
          {ticket.category !== 'unspecified' && <span>· {SUPPORT_CATEGORY_LABELS[ticket.category]}</span>}
          <span>· ouverte le {formatDate(ticket.reported_at, 'date')}</span>
          {ticket.page_label && <span className="inline-flex items-center gap-1">· <IconMapPin size={13} aria-hidden="true" />Page concernée : {ticket.page_label}{ticket.resource_label ? ` · ${ticket.resource_label}` : ''}</span>}
        </p>
      </header>

      <ol className="flex flex-1 flex-col gap-3 py-2" aria-label="Conversation">
        {items.map((item) => {
          if (item.kind === 'event') {
            return (
              <li key={item.event.id} className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-a-surface-2 px-3 py-1 text-xs text-a-text-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-a-text-3" />{eventText(item.event)} · {formatDate(item.at, 'short')}
                </span>
              </li>
            );
          }
          const message = item.message;
          const fromLepefy = message.author_type === 'lepefy';
          const readAt = firstUnreadAt.current;
          const showDivider = !dividerShown && fromLepefy && !message.relayed_from && Boolean(readAt) && message.created_at > (readAt ?? '');
          if (showDivider) dividerShown = true;
          return (
            <li key={message.id} className="space-y-3">
              {showDivider && (
                <div className="flex items-center gap-2 text-xs font-semibold text-tone-info-fg" role="separator" aria-label="Nouveaux messages">
                  <span className="h-px flex-1 bg-tone-info-border" />Nouveau<span className="h-px flex-1 bg-tone-info-border" />
                </div>
              )}
              <div className={cn('flex', fromLepefy && !message.relayed_from ? 'justify-start' : 'justify-end')}>
                <article className={cn('max-w-[88%] space-y-1.5 rounded-2xl px-3.5 py-2.5 sm:max-w-[75%]',
                  fromLepefy && !message.relayed_from ? 'rounded-bl-md border border-a-border bg-a-surface' : 'rounded-br-md bg-a-brand-soft')}>
                  <p className="text-xs font-semibold text-a-text-2">
                    {message.relayed_from
                      ? `Votre demande reçue par ${SUPPORT_CHANNEL_LABELS[message.relayed_from]}${message.original_sent_at ? ` le ${formatDate(message.original_sent_at, 'datetime')}` : ''} · saisie par l’équipe Lepefy`
                      : fromLepefy ? 'Équipe Lepefy' : message.mine ? 'Vous' : (message.author_label ?? 'Votre équipe')}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-a-text sm:text-sm">{message.body}</p>
                  {message.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {message.attachments.map((file, index) => (
                        <SupportImage key={file.id} src={`/api/admin/assistance/attachments/${file.id}`} width={file.width} height={file.height} label={`Capture ${index + 1}`} />
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-a-text-3"><time dateTime={message.created_at}>{formatDate(message.created_at, 'datetime')}</time></p>
                </article>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-3 mt-2 border-t border-a-border bg-a-bg px-3 pb-3 pt-3 sm:-mx-5 sm:px-5 md:bottom-0">
        {askFeedback ? (
          <div className="space-y-3 rounded-xl border border-tone-success-border bg-tone-success-bg p-3.5" role="region" aria-label="Avis sur la résolution">
            <p className="flex items-center gap-2 text-sm font-semibold text-a-text"><IconCircleCheck size={18} aria-hidden="true" className="text-tone-success-fg" />Est-ce que le problème est résolu ?</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void feedback(true)} loading={feedbackBusy === true} disabled={feedbackBusy !== null}>Oui, merci</Button>
              <Button variant="secondary" onClick={() => void feedback(false)} loading={feedbackBusy === false} disabled={feedbackBusy !== null}>Non, j’ai encore un problème</Button>
            </div>
            {feedbackError && <p className="text-sm text-tone-danger-fg" role="alert">{feedbackError}</p>}
            {!writeAnyway && (
              <button type="button" onClick={() => setWriteAnyway(true)} className="text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline">Écrire un message</button>
            )}
          </div>
        ) : null}
        {merged ? (
          <InlineAlert tone="info" title={`Cette demande a été regroupée avec la demande ${supportReference(merged)}.`}
            action={<Link href={`/admin/assistance?q=${merged}`} className="text-sm font-semibold text-a-brand-fg underline underline-offset-2">Voir la demande {merged}</Link>}>
            Écrivez dans cette demande pour continuer.
          </InlineAlert>
        ) : closed ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-a-border bg-a-surface p-3.5">
            <p className="text-sm text-a-text-2">Cette demande est terminée. Un nouveau souci ?</p>
            <SupportOpenButton variant="secondary"><IconPlus size={16} aria-hidden="true" />Nouvelle demande</SupportOpenButton>
          </div>
        ) : askFeedback && !writeAnyway ? null : readOnly ? (
          <InlineAlert tone="info">Aperçu de la vue boutique : répondez depuis la console « Assistance tenants ».</InlineAlert>
        ) : (
          <ThreadComposer onSend={send} uploadEndpoint="/api/admin/assistance/attachments"
            className={askFeedback ? 'mt-3' : undefined}
            placeholder={askFeedback ? 'Ce qui ne fonctionne toujours pas (la demande sera rouverte)…' : ticket.tenant_status === 'waiting_you' ? 'Votre réponse à l’équipe Lepefy…' : 'Ajouter une précision…'} />
        )}
        {!closed && !merged && !readOnly && !(askFeedback && !writeAnyway) && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-a-text-3"><IconLifebuoy size={14} aria-hidden="true" />L’équipe Lepefy vous répond ici et vous prévient par e-mail.</p>
        )}
      </div>
      {/* After the composer: scrolling here shows the last message above it, never under it. */}
      <div ref={endRef} />
    </div>
  );
}
