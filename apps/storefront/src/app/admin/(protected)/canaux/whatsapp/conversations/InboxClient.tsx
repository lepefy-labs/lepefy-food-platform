'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconArrowLeft, IconHandStop, IconPlayerPlay, IconRobot, IconSend, IconSparkles, IconUser, IconCheck } from '@tabler/icons-react';
import Button from '../../../../_components/ui/Button';
import type { ConversationDetail, InboxFilter, InboxItem, InboxState } from '@/lib/whatsapp/adminQueries';

const POLL_MS = 10_000;

const FILTERS: ReadonlyArray<{ key: InboxFilter; label: string }> = [
  { key: 'all', label: 'Toutes' },
  { key: 'needs_human', label: 'Opérateur demandé' },
  { key: 'human', label: 'En charge' },
  { key: 'automated', label: 'Automatiques' },
  { key: 'closed', label: 'Fermées' },
];

const STATE_META: Record<InboxState, { label: string; cls: string }> = {
  nala: { label: 'Nala', cls: 'bg-a-brand-soft text-a-brand-fg' },
  automation: { label: 'Automatisation', cls: 'bg-tone-info-bg text-tone-info-fg' },
  needs_human: { label: 'Opérateur demandé', cls: 'bg-tone-warning-bg text-tone-warning-fg' },
  human: { label: 'Opérateur', cls: 'bg-tone-success-bg text-tone-success-fg' },
  closed: { label: 'Fermée', cls: 'bg-a-hover text-a-text-2' },
  open: { label: 'Nouvelle', cls: 'bg-tone-info-bg text-tone-info-fg' },
};

const AUTHOR_LABEL: Record<string, string> = { customer: 'Client', automation: 'Automatisation', nala: 'Nala', agent: 'Équipe', system: 'Système' };
const STATUS_LABEL: Record<string, string> = { pending: 'Envoi…', sent: 'Envoyé', delivered: 'Distribué', read: 'Lu', failed: 'Échec' };

function StateBadge({ state }: { state: InboxState }) {
  const meta = STATE_META[state];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>{meta.label}</span>;
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function time(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function InboxClient({ initialItems, initialFilter, initialSelectedId, canReply, channelDisabled }: {
  initialItems: InboxItem[];
  initialFilter: InboxFilter;
  initialSelectedId: string | null;
  canReply: boolean;
  channelDisabled: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState(initialFilter);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(async (nextFilter: InboxFilter) => {
    const response = await fetch(`/api/admin/whatsapp/conversations?filter=${nextFilter}`, { cache: 'no-store' });
    if (response.ok) setItems(((await response.json()) as { items: InboxItem[] }).items);
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    const response = await fetch(`/api/admin/whatsapp/conversations/${id}`, { cache: 'no-store' });
    if (!response.ok) { setDetail(null); setDetailError('Conversation introuvable.'); return; }
    setDetailError(null);
    setDetail(await response.json() as ConversationDetail);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('filter', filter);
    if (selectedId) url.searchParams.set('c', selectedId); else url.searchParams.delete('c');
    window.history.replaceState(null, '', url.toString());
  }, [filter, selectedId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    void refreshDetail(selectedId);
    void fetch(`/api/admin/whatsapp/conversations/${selectedId}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_read' }),
    }).catch(() => undefined);
  }, [selectedId, refreshDetail]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refreshList(filter);
      if (selectedId) void refreshDetail(selectedId);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [filter, selectedId, refreshList, refreshDetail]);

  useEffect(() => { threadEnd.current?.scrollIntoView({ block: 'end' }); }, [detail?.messages.length]);

  async function changeFilter(next: InboxFilter) {
    setFilter(next);
    await refreshList(next);
  }

  async function runAction(action: 'take_over' | 'resume' | 'close') {
    if (!selectedId) return;
    setBusy(action);
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/whatsapp/conversations/${selectedId}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || 'Action impossible.');
      await Promise.all([refreshDetail(selectedId), refreshList(filter)]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Action impossible.');
    } finally {
      setBusy(null);
    }
  }

  async function sendMessage() {
    if (!selectedId || !draft.trim()) return;
    setBusy('send');
    setActionError(null);
    try {
      const response = await fetch(`/api/admin/whatsapp/conversations/${selectedId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: draft }),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || 'Envoi impossible.');
      setDraft('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Envoi impossible.');
    } finally {
      setBusy(null);
      await Promise.all([refreshDetail(selectedId), refreshList(filter)]);
    }
  }

  const conversation = detail?.conversation ?? null;
  const paused = conversation?.automation_status === 'paused';

  return (
    <div className="grid min-h-[60vh] overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm md:grid-cols-[320px_minmax(0,1fr)]">
      {/* Liste */}
      <aside className={`${selectedId ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-a-border`}>
        <div className="flex gap-1 overflow-x-auto border-b border-a-border p-2">
          {FILTERS.map((option) => (
            <button key={option.key} type="button" onClick={() => void changeFilter(option.key)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${filter === option.key ? 'bg-a-brand-soft text-a-brand-fg' : 'text-a-text-2 hover:bg-a-hover'}`}>
              {option.label}
            </button>
          ))}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-a-text-3">Aucune conversation.</li>}
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => setSelectedId(item.id)}
                className={`w-full border-b border-a-border px-4 py-3 text-left transition-colors ${selectedId === item.id ? 'bg-a-brand-soft' : 'hover:bg-a-surface-2'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-a-text">{item.customerName ?? item.customerPhone ?? 'Client WhatsApp'}</span>
                  <span className="shrink-0 text-xs text-a-text-3">{relative(item.lastMessageAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-a-text-3">
                  {item.preview ? `${item.preview.direction === 'outbound' ? `${AUTHOR_LABEL[item.preview.author] ?? ''} : ` : ''}${item.preview.text}` : '—'}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <StateBadge state={item.state} />
                  {item.unreadCount > 0 && <span className="rounded-full bg-tone-success-solid px-1.5 text-xs font-semibold text-white">{item.unreadCount}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Fil */}
      <section className={`${selectedId ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
        {!selectedId && <div className="m-auto p-8 text-sm text-a-text-3">Sélectionnez une conversation.</div>}
        {selectedId && detailError && <div className="m-auto p-8 text-sm text-a-text-3">{detailError}</div>}
        {selectedId && conversation && detail && (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b border-a-border px-4 py-3">
              <button type="button" className="md:hidden" aria-label="Retour à la liste" onClick={() => setSelectedId(null)}><IconArrowLeft size={18} /></button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-a-text">{conversation.customer_name ?? conversation.customer_phone ?? 'Client WhatsApp'}</h2>
                  <StateBadge state={detail.state} />
                </div>
                <p className="text-xs text-a-text-3">
                  {conversation.customer_phone ?? 'Numéro masqué (username WhatsApp)'}
                  {detail.customer ? <> · <a className="underline" href={`/admin/clients/${detail.customer.id}`}>fiche client</a></> : ' · client non reconnu'}
                  {detail.openHandoff ? ` · opérateur demandé (${detail.openHandoff.reason})` : ''}
                </p>
              </div>
              {canReply && (
                <div className="flex flex-wrap gap-2">
                  {conversation.status !== 'human' && (
                    <Button variant="outline" onClick={() => void runAction('take_over')} loading={busy === 'take_over'}><IconHandStop size={16} /> Prendre la main</Button>
                  )}
                  {paused && (
                    <Button variant="outline" onClick={() => void runAction('resume')} loading={busy === 'resume'}><IconPlayerPlay size={16} /> Rendre à l’automatisation</Button>
                  )}
                  {conversation.status !== 'closed' && (
                    <Button variant="ghost" onClick={() => void runAction('close')} loading={busy === 'close'}><IconCheck size={16} /> Fermer</Button>
                  )}
                </div>
              )}
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-a-surface-2 px-4 py-4" aria-live="polite">
              {detail.messages.map((message) => {
                const outbound = message.direction === 'outbound';
                const AuthorIcon = message.author_type === 'nala' ? IconSparkles : message.author_type === 'automation' ? IconRobot : IconUser;
                return (
                  <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${outbound
                      ? message.author_type === 'agent' ? 'bg-tone-success-solid text-white' : 'bg-a-brand-soft text-a-text ring-1 ring-a-border'
                      : 'bg-a-surface text-a-text ring-1 ring-a-border'}`}>
                      <div className={`mb-0.5 flex items-center gap-1 text-xs ${outbound && message.author_type === 'agent' ? 'text-tone-success-fg' : 'text-a-text-3'}`}>
                        <AuthorIcon size={12} aria-hidden="true" /> {AUTHOR_LABEL[message.author_type] ?? message.author_type} · {time(message.created_at)}
                        {outbound && <> · {STATUS_LABEL[message.status] ?? message.status}</>}
                      </div>
                      <p className="whitespace-pre-wrap break-words">{message.body ?? <em className="opacity-70">[{message.message_type}]</em>}</p>
                      {message.status === 'failed' && message.error_title && <p className="mt-1 text-xs text-tone-danger-fg">{message.error_title}</p>}
                    </div>
                  </div>
                );
              })}
              <div ref={threadEnd} />
            </div>

            {canReply && (
              <footer className="border-t border-a-border p-3">
                {actionError && <p className="mb-2 text-xs text-tone-danger-fg" role="alert">{actionError}</p>}
                {/* Rappel au point d'action : après une réponse, l'automatisation reste en pause jusqu'à la reprise. */}
                {paused && (
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tone-warning-border bg-tone-warning-bg px-3 py-2">
                    <p className="text-xs text-tone-warning-fg">
                      Automatisation en pause : les réponses automatiques et Nala ne répondent plus à ce client.
                    </p>
                    <Button variant="outline" size="md" onClick={() => void runAction('resume')} loading={busy === 'resume'}>
                      <IconPlayerPlay size={16} /> Rendre à l’automatisation
                    </Button>
                  </div>
                )}
                {channelDisabled ? (
                  <p className="text-xs text-a-text-3">Canal désactivé : envoi impossible.</p>
                ) : !detail.withinServiceWindow ? (
                  <p className="text-xs text-tone-warning-fg">Plus de 24 h depuis le dernier message du client : WhatsApp exige un modèle approuvé (non disponible dans cette version).</p>
                ) : (
                  <div className="flex items-end gap-2">
                    <textarea
                      rows={2} maxLength={4096} value={draft} onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void sendMessage(); }}
                      placeholder="Écrire un message… (Ctrl+Entrée pour envoyer)"
                      className="min-h-[44px] flex-1 resize-y rounded-xl border border-a-border bg-a-surface px-3 py-2 text-sm"
                    />
                    <Button onClick={() => void sendMessage()} loading={busy === 'send'} disabled={!draft.trim()} aria-label="Envoyer"><IconSend size={16} /></Button>
                  </div>
                )}
                {!paused && !channelDisabled && detail.withinServiceWindow && <p className="mt-1.5 text-xs text-a-text-3">Envoyer un message met l’automatisation en pause pour ce client.</p>}
              </footer>
            )}
          </>
        )}
      </section>
    </div>
  );
}
