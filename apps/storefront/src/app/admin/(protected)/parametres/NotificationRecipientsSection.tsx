'use client';

import { useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import type { TenantNotificationRecipient } from '@lepefy/types';
import { SettingsFeedback, SettingsPanel, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

type NotifyField =
  | 'notify_card_payment'
  | 'notify_external_payment_pending'
  | 'notify_order_stock_conflict'
  | 'notify_event_booking_closed_reports'
  | 'notify_daily_digest'
  | 'notify_service_inquiries'
  | 'notify_rental_reservations';

// Presentation-only grouping of the existing per-recipient flags
// (tenant_notification_recipients.notify_*): the schema is unchanged.
const NOTIFICATION_GROUPS: Array<{ label: string; items: Array<{ field: NotifyField; label: string; short: string }> }> = [
  {
    label: 'Commandes & paiements',
    items: [
      { field: 'notify_card_payment', label: 'Paiement carte', short: 'Paiement carte' },
      { field: 'notify_external_payment_pending', label: 'Paiement externe à vérifier', short: 'Paiement à vérifier' },
      { field: 'notify_order_stock_conflict', label: 'Conflit de stock', short: 'Stock' },
    ],
  },
  {
    label: 'Événementiel',
    items: [
      { field: 'notify_event_booking_closed_reports', label: 'Rapports de fin des réservations', short: 'Clôture' },
      { field: 'notify_service_inquiries', label: 'Demandes de devis', short: 'Devis' },
      { field: 'notify_rental_reservations', label: 'Réservations matériel', short: 'Location' },
    ],
  },
  {
    label: 'Rapports',
    items: [{ field: 'notify_daily_digest', label: 'Rapport quotidien (08h)', short: 'Digest' }],
  },
];
const ALL_ITEMS = NOTIFICATION_GROUPS.flatMap((group) => group.items);
const GROUP_STARTS = new Set(NOTIFICATION_GROUPS.map((group) => group.items[0]?.field));

type NewForm = { email: string; label: string } & Record<NotifyField, boolean>;

function emptyForm(): NewForm {
  return { email: '', label: '', notify_card_payment: true, notify_external_payment_pending: true, notify_order_stock_conflict: false, notify_event_booking_closed_reports: true, notify_daily_digest: false, notify_service_inquiries: false, notify_rental_reservations: false };
}

const CHECKBOX_CLS = 'h-5 w-5 cursor-pointer accent-[var(--admin-primary)] disabled:cursor-not-allowed';

export function NotificationRecipientsSection({ initialRecipients }: { initialRecipients: TenantNotificationRecipient[] }) {
  const [recipients, setRecipients] = useState(initialRecipients);
  const [newForm, setNewForm] = useState<NewForm>(emptyForm());
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const { feedback, show: showToast } = useSettingsFeedback();

  async function handleCreate() {
    setIsSaving('new');
    try {
      const res = await fetch('/api/admin/notification-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newForm) });
      if (!res.ok) { const body = await res.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error ?? 'Erreur'); }
      const created = await res.json() as TenantNotificationRecipient;
      setRecipients((prev) => [...prev, created]); setNewForm(emptyForm()); showToast('Destinataire ajouté', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Erreur lors de l’ajout', 'error'); } finally { setIsSaving(null); }
  }

  async function handlePatch(id: string, patch: Partial<TenantNotificationRecipient>) {
    setIsSaving(id); setRecipients((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
    try { const res = await fetch(`/api/admin/notification-recipients/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); if (!res.ok) throw new Error(); showToast('Enregistré', 'success'); }
    catch { showToast('Erreur lors de l’enregistrement', 'error'); } finally { setIsSaving(null); }
  }

  async function handleDelete(id: string) {
    setIsSaving(id);
    try { const res = await fetch(`/api/admin/notification-recipients/${id}`, { method: 'DELETE' }); if (!res.ok) throw new Error(); setRecipients((prev) => prev.filter((r) => r.id !== id)); showToast('Destinataire supprimé', 'success'); }
    catch { showToast('Erreur lors de la suppression', 'error'); } finally { setIsSaving(null); }
  }

  const nameOf = (r: TenantNotificationRecipient) => r.label || r.email;

  return (
    <>
      <SettingsPanel
        id="destinataires"
        title="Destinataires"
        description="Cochez les notifications internes reçues par chaque destinataire. Chaque modification est enregistrée immédiatement."
        aside={<SettingsFeedback feedback={feedback} />}
      >
        {recipients.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">Aucun destinataire configuré.</p>
        ) : (
          <>
            {/* Desktop: recipients × notification types matrix */}
            <div className="-mx-4 hidden overflow-x-auto sm:-mx-6 xl:block">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <caption className="sr-only">Notifications reçues par destinataire</caption>
                <thead>
                  <tr className="text-xs text-gray-500 dark:text-gray-400">
                    <th scope="col" rowSpan={2} className="px-6 pb-2 text-left align-bottom font-medium">Destinataire</th>
                    {NOTIFICATION_GROUPS.map((group) => (
                      <th key={group.label} scope="colgroup" colSpan={group.items.length} className="border-l border-gray-100 px-2 pb-1 text-center font-semibold uppercase tracking-[0.08em] dark:border-gray-800">{group.label}</th>
                    ))}
                    <th scope="col" rowSpan={2} className="border-l border-gray-100 px-3 pb-2 text-center align-bottom font-medium dark:border-gray-800">Actif</th>
                    <th scope="col" rowSpan={2} className="px-6 pb-2 align-bottom"><span className="sr-only">Actions</span></th>
                  </tr>
                  <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    {NOTIFICATION_GROUPS.map((group) => group.items.map((item, index) => (
                      <th key={item.field} scope="col" title={item.label} className={`px-2 pb-2 text-center font-medium ${index === 0 ? 'border-l border-gray-100 dark:border-gray-800' : ''}`}>{item.short}</th>
                    )))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {recipients.map((r) => (
                    <tr key={r.id} className={r.active ? '' : 'text-gray-400'}>
                      <th scope="row" className="max-w-[200px] py-3 pl-6 pr-2 text-left font-normal">
                        <span className={`block truncate font-medium ${r.active ? 'text-gray-950 dark:text-gray-100' : 'text-gray-500'}`}>{nameOf(r)}</span>
                        {r.label && <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{r.email}</span>}
                      </th>
                      {ALL_ITEMS.map((item) => (
                        <td key={item.field} className={`px-2 text-center ${GROUP_STARTS.has(item.field) ? 'border-l border-gray-100 dark:border-gray-800' : ''}`}>
                          <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-50 dark:hover:bg-white/5">
                            <span className="sr-only">{`${item.label} — ${nameOf(r)}`}</span>
                            <input type="checkbox" className={CHECKBOX_CLS} checked={Boolean(r[item.field])} disabled={isSaving === r.id} onChange={(e) => handlePatch(r.id, { [item.field]: e.target.checked } as Partial<TenantNotificationRecipient>)} />
                          </label>
                        </td>
                      ))}
                      <td className="border-l border-gray-100 px-3 text-center dark:border-gray-800">
                        <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-50 dark:hover:bg-white/5">
                          <span className="sr-only">{`Destinataire actif — ${nameOf(r)}`}</span>
                          <input type="checkbox" className={CHECKBOX_CLS} checked={r.active} disabled={isSaving === r.id} onChange={(e) => handlePatch(r.id, { active: e.target.checked })} />
                        </label>
                      </td>
                      <td className="px-6 text-right">
                        <button type="button" onClick={() => handleDelete(r.id)} disabled={isSaving === r.id} aria-label={`Supprimer ${r.email}`} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] disabled:opacity-50 dark:hover:bg-red-950/30"><IconTrash size={17} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Below xl: one block per recipient, grouped toggles */}
            <ul className="grid gap-4 md:grid-cols-2 xl:hidden">
              {recipients.map((r) => (
                <li key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-950 dark:text-gray-100">{nameOf(r)}</p>
                      {r.label && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{r.email}</p>}
                    </div>
                    <button type="button" onClick={() => handleDelete(r.id)} disabled={isSaving === r.id} aria-label={`Supprimer ${r.email}`} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] disabled:opacity-50"><IconTrash size={17} /></button>
                  </div>
                  <div className="space-y-3 px-4 py-3">
                    <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                      Destinataire actif
                      <input type="checkbox" className={CHECKBOX_CLS} checked={r.active} disabled={isSaving === r.id} onChange={(e) => handlePatch(r.id, { active: e.target.checked })} />
                    </label>
                    {NOTIFICATION_GROUPS.map((group) => (
                      <fieldset key={group.label}>
                        <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">{group.label}</legend>
                        {group.items.map((item) => (
                          <label key={item.field} className="flex min-h-11 items-center justify-between gap-3 text-sm text-gray-700 dark:text-gray-300">
                            {item.label}
                            <input type="checkbox" className={CHECKBOX_CLS} checked={Boolean(r[item.field])} disabled={isSaving === r.id} onChange={(e) => handlePatch(r.id, { [item.field]: e.target.checked } as Partial<TenantNotificationRecipient>)} />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </SettingsPanel>

      <SettingsPanel id="ajouter" title="Ajouter un destinataire" description="La personne recevra les notifications cochées à cette adresse.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="recipient-new-email" className={SETTINGS_LABEL_CLS}>Email</label>
            <input id="recipient-new-email" type="email" autoComplete="off" value={newForm.email} onChange={(e) => setNewForm({ ...newForm, email: e.target.value })} placeholder="contact@boutique.com" className={SETTINGS_INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="recipient-new-label" className={SETTINGS_LABEL_CLS}>Étiquette</label>
            <input id="recipient-new-label" type="text" value={newForm.label} onChange={(e) => setNewForm({ ...newForm, label: e.target.value })} placeholder="ex : Cuisine" className={SETTINGS_INPUT_CLS} />
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {NOTIFICATION_GROUPS.map((group) => (
            <fieldset key={group.label}>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">{group.label}</legend>
              {group.items.map((item) => (
                <label key={item.field} className="flex min-h-11 items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" className={CHECKBOX_CLS} checked={newForm[item.field]} onChange={(e) => setNewForm({ ...newForm, [item.field]: e.target.checked })} />
                  {item.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <Button type="button" onClick={handleCreate} loading={isSaving === 'new'} disabled={!newForm.email.trim()} className="mt-4 min-h-11">{isSaving !== 'new' && <IconPlus size={16} aria-hidden="true" />}Ajouter le destinataire</Button>
      </SettingsPanel>
    </>
  );
}
