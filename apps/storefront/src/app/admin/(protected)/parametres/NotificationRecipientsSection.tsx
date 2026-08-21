'use client';

import { useState } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import type { TenantNotificationRecipient } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface NewForm {
  email: string;
  label: string;
  notify_card_payment: boolean;
  notify_order_stock_conflict: boolean;
}

function emptyForm(): NewForm {
  return { email: '', label: '', notify_card_payment: true, notify_order_stock_conflict: false };
}

interface NotificationRecipientsSectionProps {
  initialRecipients: TenantNotificationRecipient[];
}

export function NotificationRecipientsSection({ initialRecipients }: NotificationRecipientsSectionProps) {
  const [recipients, setRecipients] = useState<TenantNotificationRecipient[]>(initialRecipients);
  const [newForm, setNewForm] = useState<NewForm>(emptyForm());
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleCreate() {
    setIsSaving('new');
    try {
      const res = await fetch('/api/admin/notification-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Erreur');
      }
      const created = await res.json() as TenantNotificationRecipient;
      setRecipients((prev) => [...prev, created]);
      setNewForm(emptyForm());
      showToast('Destinataire ajouté', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de l\'ajout', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  async function handlePatch(id: string, patch: Partial<TenantNotificationRecipient>) {
    setIsSaving(id);
    setRecipients((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      const res = await fetch(`/api/admin/notification-recipients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleDelete(id: string) {
    setIsSaving(id);
    try {
      const res = await fetch(`/api/admin/notification-recipients/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setRecipients((prev) => prev.filter((r) => r.id !== id));
      showToast('Destinataire supprimé', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Destinataires des notifications</h2>
      <p className="text-xs text-gray-400 mb-4">
        Emails de l&apos;équipe (boutique/propriétaire) à notifier sur certains événements internes, par exemple un paiement Card réussi.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-3 mb-6">
        {recipients.map((r) => (
          <div key={r.id} className="border border-gray-100 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={LABEL_CLS}>Email</label>
                <p className="text-sm text-gray-900">{r.email}</p>
              </div>
              <div>
                <label className={LABEL_CLS}>Étiquette</label>
                <input
                  type="text"
                  defaultValue={r.label ?? ''}
                  onBlur={(e) => {
                    const next = e.target.value || null;
                    if (next !== r.label) handlePatch(r.id, { label: next });
                  }}
                  placeholder="Ex : Dalice"
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={r.notify_card_payment}
                  onChange={(e) => handlePatch(r.id, { notify_card_payment: e.target.checked })}
                  disabled={isSaving === r.id}
                />
                Paiement carte
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={r.notify_order_stock_conflict}
                  onChange={(e) => handlePatch(r.id, { notify_order_stock_conflict: e.target.checked })}
                  disabled={isSaving === r.id}
                />
                Conflit de stock
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={(e) => handlePatch(r.id, { active: e.target.checked })}
                  disabled={isSaving === r.id}
                />
                Actif
              </label>

              <button
                onClick={() => handleDelete(r.id)}
                disabled={isSaving === r.id}
                className="ml-auto px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 flex items-center gap-1 disabled:opacity-50"
              >
                <IconTrash size={14} stroke={1.5} />
                Supprimer
              </button>
            </div>
          </div>
        ))}

        {recipients.length === 0 && (
          <p className="text-sm text-gray-400">Aucun destinataire configuré pour le moment.</p>
        )}
      </div>

      <div className="border border-dashed border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-500 mb-3">Ajouter un destinataire</p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={LABEL_CLS}>Email</label>
            <input
              type="email"
              value={newForm.email}
              onChange={(e) => setNewForm({ ...newForm, email: e.target.value })}
              placeholder="contact@boutique.com"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Étiquette (optionnel)</label>
            <input
              type="text"
              value={newForm.label}
              onChange={(e) => setNewForm({ ...newForm, label: e.target.value })}
              placeholder="Ex : Dalice"
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={newForm.notify_card_payment}
              onChange={(e) => setNewForm({ ...newForm, notify_card_payment: e.target.checked })}
            />
            Paiement carte
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={newForm.notify_order_stock_conflict}
              onChange={(e) => setNewForm({ ...newForm, notify_order_stock_conflict: e.target.checked })}
            />
            Conflit de stock
          </label>
        </div>

        <Button
          onClick={handleCreate}
          loading={isSaving === 'new'}
          disabled={!newForm.email.trim()}
        >
          {isSaving !== 'new' && <IconPlus size={14} stroke={1.5} />}
          Ajouter
        </Button>
      </div>
    </section>
  );
}
