'use client';

import { useState } from 'react';
import { IconBell, IconPlus, IconTrash } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import type { TenantNotificationRecipient } from '@lepefy/types';

const INPUT_CLS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300';

interface NewForm {
  email: string;
  label: string;
  notify_card_payment: boolean;
  notify_external_payment_pending: boolean;
  notify_order_stock_conflict: boolean;
}

function emptyForm(): NewForm {
  return {
    email: '',
    label: '',
    notify_card_payment: true,
    notify_external_payment_pending: true,
    notify_order_stock_conflict: false,
  };
}

export function NotificationRecipientsSection({ initialRecipients }: { initialRecipients: TenantNotificationRecipient[] }) {
  const [recipients, setRecipients] = useState<TenantNotificationRecipient[]>(initialRecipients);
  const [newForm, setNewForm] = useState<NewForm>(emptyForm());
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  function showToast(msg: string, type: 'success' | 'error') { setToast({ msg, type }); setTimeout(() => setToast(null), 2500); }

  async function handleCreate() {
    setIsSaving('new');
    try {
      const res = await fetch('/api/admin/notification-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newForm) });
      if (!res.ok) { const body = await res.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error ?? 'Erreur'); }
      const created = await res.json() as TenantNotificationRecipient;
      setRecipients((prev) => [...prev, created]); setNewForm(emptyForm()); showToast('Destinataire ajouté', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Erreur lors de l\'ajout', 'error'); } finally { setIsSaving(null); }
  }

  async function handlePatch(id: string, patch: Partial<TenantNotificationRecipient>) {
    setIsSaving(id); setRecipients((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try { const res = await fetch(`/api/admin/notification-recipients/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); if (!res.ok) throw new Error(); showToast('Enregistré', 'success'); }
    catch { showToast('Erreur lors de l\'enregistrement', 'error'); } finally { setIsSaving(null); }
  }

  async function handleDelete(id: string) {
    setIsSaving(id);
    try { const res = await fetch(`/api/admin/notification-recipients/${id}`, { method: 'DELETE' }); if (!res.ok) throw new Error(); setRecipients((prev) => prev.filter((r) => r.id !== id)); showToast('Destinataire supprimé', 'success'); }
    catch { showToast('Erreur lors de la suppression', 'error'); } finally { setIsSaving(null); }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-sky-600 shadow-sm dark:bg-gray-800 dark:text-sky-300"><IconBell size={19} stroke={1.7} /></div>
        <div><h2 className="text-sm font-semibold text-sky-700 dark:text-sky-200">Notifications</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Destinataires et événements internes</p></div>
      </header>

      <div className="p-4 sm:p-5">
        {toast && <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}
        <div className="space-y-2">
          {recipients.map((r) => (
            <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/30">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--admin-primary-soft)] text-xs font-semibold text-[var(--admin-primary-fg)]">{(r.label || r.email).slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{r.label || r.email}</p><p className="truncate text-xs text-gray-500">{r.email}</p></div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${r.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.active ? 'Actif' : 'Inactif'}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 text-xs text-gray-600 dark:bg-gray-800"><span>Paiement carte</span><input type="checkbox" checked={r.notify_card_payment} onChange={(e) => handlePatch(r.id, { notify_card_payment: e.target.checked })} disabled={isSaving === r.id} /></label>
                <label className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 text-xs text-gray-600 dark:bg-gray-800"><span>Paiement externe à vérifier</span><input type="checkbox" checked={r.notify_external_payment_pending ?? false} onChange={(e) => handlePatch(r.id, { notify_external_payment_pending: e.target.checked })} disabled={isSaving === r.id} /></label>
                <label className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 text-xs text-gray-600 dark:bg-gray-800"><span>Conflit de stock</span><input type="checkbox" checked={r.notify_order_stock_conflict} onChange={(e) => handlePatch(r.id, { notify_order_stock_conflict: e.target.checked })} disabled={isSaving === r.id} /></label>
                <div className="flex items-center justify-between gap-2"><label className="flex min-h-9 flex-1 items-center justify-between rounded-lg bg-gray-50 px-3 text-xs text-gray-600 dark:bg-gray-800"><span>Actif</span><input type="checkbox" checked={r.active} onChange={(e) => handlePatch(r.id, { active: e.target.checked })} disabled={isSaving === r.id} /></label><button onClick={() => handleDelete(r.id)} disabled={isSaving === r.id} className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label={`Supprimer ${r.email}`}><IconTrash size={15} /></button></div>
              </div>
            </div>
          ))}
          {recipients.length === 0 && <p className="rounded-xl border border-dashed border-sky-200 bg-sky-50/30 p-4 text-sm text-gray-500">Aucun destinataire configuré.</p>}
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-sky-200 bg-sky-50/30 p-3">
          <p className="mb-3 text-xs font-semibold text-sky-700">Ajouter un destinataire</p>
          <div className="grid gap-3 sm:grid-cols-2"><div><label className={LABEL_CLS}>Email</label><input type="email" value={newForm.email} onChange={(e) => setNewForm({ ...newForm, email: e.target.value })} placeholder="contact@boutique.com" className={INPUT_CLS} /></div><div><label className={LABEL_CLS}>Étiquette</label><input type="text" value={newForm.label} onChange={(e) => setNewForm({ ...newForm, label: e.target.value })} placeholder="Ex : Dalice" className={INPUT_CLS} /></div></div>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={newForm.notify_card_payment} onChange={(e) => setNewForm({ ...newForm, notify_card_payment: e.target.checked })} />Paiement carte</label>
            <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={newForm.notify_external_payment_pending} onChange={(e) => setNewForm({ ...newForm, notify_external_payment_pending: e.target.checked })} />Paiement externe à vérifier</label>
            <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={newForm.notify_order_stock_conflict} onChange={(e) => setNewForm({ ...newForm, notify_order_stock_conflict: e.target.checked })} />Conflit de stock</label>
          </div>
          <Button onClick={handleCreate} loading={isSaving === 'new'} disabled={!newForm.email.trim()} className="mt-3">{isSaving !== 'new' && <IconPlus size={14} />}Ajouter</Button>
        </div>
      </div>
    </section>
  );
}
