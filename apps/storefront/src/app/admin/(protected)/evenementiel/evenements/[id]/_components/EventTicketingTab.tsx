'use client';

import { useState } from 'react';
import { IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import Button from '../../../../../_components/ui/Button';
import type { EventTicketType } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';

export default function EventTicketingTab({
  ticketTypes,
  currency,
  adding,
  savingId,
  error,
  onCreate,
  onUpdate,
  onRemove,
}: {
  ticketTypes: EventTicketType[];
  currency: string;
  adding: boolean;
  savingId: string | null;
  error: string | null;
  onCreate: (payload: { label: string; description: string | null; price: number; badge: string | null }) => Promise<boolean>;
  onUpdate: (id: string, payload: { label: string; description: string | null; price: number; badge: string | null }) => Promise<boolean>;
  onRemove: (id: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: '', description: '', price: '', badge: '' });

  const inputClass = 'min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

  function startEdit(ticket: EventTicketType) {
    setEditingId(ticket.id);
    setDraft({ label: ticket.label, description: ticket.description ?? '', price: String(ticket.price), badge: ticket.badge ?? '' });
  }

  function resetEditor() {
    setEditingId(null);
    setShowCreate(false);
    setDraft({ label: '', description: '', price: '', badge: '' });
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(draft.price);
    if (!draft.label.trim() || !Number.isFinite(price) || price < 0) return;
    const ok = await onCreate({ label: draft.label.trim(), description: draft.description.trim() || null, price, badge: draft.badge.trim() || null });
    if (ok) resetEditor();
  }

  async function submitEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    const price = Number(draft.price);
    if (!draft.label.trim() || !Number.isFinite(price) || price < 0) return;
    const ok = await onUpdate(id, { label: draft.label.trim(), description: draft.description.trim() || null, price, badge: draft.badge.trim() || null });
    if (ok) resetEditor();
  }

  const editor = (submit: (e: React.FormEvent) => void, submitLabel: string) => (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-[var(--color-primary-light)] bg-[var(--color-primary-light)]/30 p-4 sm:grid-cols-2">
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Libellé<input value={draft.label} onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))} className={`${inputClass} mt-1`} required /></label>
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Prix<input value={draft.price} onChange={(e) => setDraft((prev) => ({ ...prev, price: e.target.value }))} className={`${inputClass} mt-1`} inputMode="decimal" required /></label>
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 sm:col-span-2">Description<input value={draft.description} onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))} className={`${inputClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 sm:col-span-2">Badge optionnel<input value={draft.badge} onChange={(e) => setDraft((prev) => ({ ...prev, badge: e.target.value }))} className={`${inputClass} mt-1`} placeholder="LA PLUS POPULAIRE" /></label>
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={adding || Boolean(savingId)}>{submitLabel}</Button><Button type="button" variant="ghost" onClick={resetEditor}><IconX size={15} /> Annuler</Button></div>
    </form>
  );

  return (
    <div className="mt-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold text-gray-950 dark:text-white">Formules</h2><p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Gérez les formules proposées pour cet événement.</p></div>
        {!showCreate && !editingId && <Button type="button" onClick={() => { setShowCreate(true); setDraft({ label: '', description: '', price: '', badge: '' }); }}><IconPlus size={16} /> Ajouter une formule</Button>}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {showCreate && editor(submitCreate, 'Ajouter la formule')}

      {ticketTypes.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">Aucune formule. Ajoutez-en une avant de publier l’événement.</div>
      ) : (
        <div className="space-y-3">
          {ticketTypes.map((ticket) => (
            <section key={ticket.id} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              {editingId === ticket.id ? editor((e) => submitEdit(e, ticket.id), 'Enregistrer les modifications') : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-gray-950 dark:text-white">{ticket.label}</h3><span className={`rounded-full px-2 py-1 text-2xs font-semibold ${ticket.active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{ticket.active ? 'Active' : 'Inactive'}</span>{ticket.badge && <span className="rounded-full bg-amber-50 px-2 py-1 text-2xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{ticket.badge}</span>}</div>
                    <p className="mt-1 text-lg font-semibold text-gray-950 dark:text-white">{formatPrice(ticket.price, currency)}</p>
                    {ticket.description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{ticket.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2"><Button type="button" variant="outline" size="sm" onClick={() => startEdit(ticket)}><IconPencil size={14} /> Modifier</Button><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(ticket.id)}><IconTrash size={14} /> {ticket.active ? 'Supprimer' : 'Retirer'}</Button></div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
