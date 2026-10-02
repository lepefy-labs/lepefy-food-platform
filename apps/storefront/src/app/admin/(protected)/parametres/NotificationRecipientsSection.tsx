'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconPlus, IconTrash, IconUsers } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import type { NotificationTeamMember, TenantNotificationRecipient } from '@lepefy/types';
import {
  NOTIFICATION_PRESETS,
  NOTIFICATION_TYPES,
  applySubscriptionChanges,
  defaultNotificationTypeKeys,
  diffSubscriptions,
  groupNotificationTypes,
  matchingPreset,
  presetTypeKeys,
  type NotificationSubscriptionChange,
  type NotificationTypeDefinition,
  type NotificationTypeKey,
} from '@/lib/notifications/notificationTypes';
import { SettingsFeedback, SettingsPanel, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

// Catalogue, defaults and profiles come from lib/notifications/notificationTypes.ts:
// a new notification type appears here without touching this file.

type Group = ReturnType<typeof groupNotificationTypes>[number];

const CHECKBOX_CLS = 'h-5 w-5 cursor-pointer accent-[var(--admin-primary)] disabled:cursor-not-allowed';
const SELECT_CLS = 'min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const GROUP_LEGEND_CLS = 'text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400';

/** Checkbox with a third, indeterminate state for partially subscribed groups. */
function TriStateCheckbox({ checked, indeterminate, label, disabled, onChange }: { checked: boolean; indeterminate: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} className={CHECKBOX_CLS} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

function groupState(subscriptions: ReadonlyArray<string>, group: Group) {
  const count = group.items.filter((item) => subscriptions.includes(item.key)).length;
  return { count, total: group.items.length, checked: count === group.items.length, indeterminate: count > 0 && count < group.items.length };
}

function keysOf(items: ReadonlyArray<NotificationTypeDefinition>): NotificationTypeKey[] {
  return items.map((item) => item.key as NotificationTypeKey);
}

export function NotificationRecipientsSection({ initialRecipients, team, typeKeys }: { initialRecipients: TenantNotificationRecipient[]; team: NotificationTeamMember[]; typeKeys: string[] }) {
  const types = useMemo<NotificationTypeDefinition[]>(() => NOTIFICATION_TYPES.filter((type) => typeKeys.includes(type.key)), [typeKeys]);
  const groups = useMemo(() => groupNotificationTypes(types), [types]);
  const visibleKeys = useMemo(() => keysOf(types), [types]);
  const teamById = useMemo(() => new Map(team.map((member) => [member.id, member])), [team]);

  const [recipients, setRecipients] = useState(initialRecipients);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const { feedback, show: showToast } = useSettingsFeedback();

  const markSaving = (ids: string[], on: boolean) => setSaving((prev) => {
    const next = new Set(prev);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  // Optimistic batch save; the server answer is canonical, errors roll back.
  async function saveChanges(changes: NotificationSubscriptionChange[]) {
    if (changes.length === 0) return;
    const ids = Array.from(new Set(changes.map((change) => change.recipientId)));
    const before = new Map(recipients.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.subscriptions]));
    setRecipients((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, subscriptions: applySubscriptionChanges(r.id, r.subscriptions, changes) } : r)));
    markSaving(ids, true);
    try {
      const res = await fetch('/api/admin/notification-recipients/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
      const body = await res.json().catch(() => null) as { error?: string; recipients?: Array<{ id: string; subscriptions: string[] }> } | null;
      if (!res.ok || !body?.recipients) throw new Error(body?.error ?? 'Erreur lors de l’enregistrement');
      const canonical = new Map(body.recipients.map((r) => [r.id, r.subscriptions]));
      setRecipients((prev) => prev.map((r) => (canonical.has(r.id) ? { ...r, subscriptions: canonical.get(r.id)! } : r)));
      showToast('Enregistré', 'success');
    } catch (err) {
      setRecipients((prev) => prev.map((r) => (before.has(r.id) ? { ...r, subscriptions: before.get(r.id)! } : r)));
      showToast(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement', 'error');
    } finally {
      markSaving(ids, false);
    }
  }

  async function patchRecipient(id: string, patch: Partial<Pick<TenantNotificationRecipient, 'active' | 'label' | 'admin_user_id'>>) {
    const previous = recipients.find((r) => r.id === id);
    setRecipients((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markSaving([id], true);
    try {
      const res = await fetch(`/api/admin/notification-recipients/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) { const body = await res.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error ?? 'Erreur lors de l’enregistrement'); }
      showToast('Enregistré', 'success');
    } catch (err) {
      if (previous) setRecipients((prev) => prev.map((r) => (r.id === id ? previous : r)));
      showToast(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement', 'error');
    } finally {
      markSaving([id], false);
    }
  }

  async function handleDelete(r: TenantNotificationRecipient) {
    if (!window.confirm(`Supprimer ${nameOf(r)} des destinataires ?`)) return;
    markSaving([r.id], true);
    try {
      const res = await fetch(`/api/admin/notification-recipients/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setRecipients((prev) => prev.filter((x) => x.id !== r.id));
      showToast('Destinataire supprimé', 'success');
    } catch { showToast('Erreur lors de la suppression', 'error'); } finally { markSaving([r.id], false); }
  }

  const nameOf = (r: TenantNotificationRecipient) => r.label || r.email;

  const toggleGroup = (r: TenantNotificationRecipient, group: Group, next: boolean) =>
    saveChanges(group.items.map((item) => ({ recipientId: r.id, typeKey: item.key as NotificationTypeKey, subscribed: next })).filter((c) => r.subscriptions.includes(c.typeKey) !== next));

  // Column header: the whole group for every recipient at once.
  function toggleGroupForAll(group: Group, next: boolean) {
    saveChanges(recipients.flatMap((r) => group.items
      .filter((item) => r.subscriptions.includes(item.key) !== next)
      .map((item) => ({ recipientId: r.id, typeKey: item.key as NotificationTypeKey, subscribed: next }))));
  }

  function applyPreset(r: TenantNotificationRecipient, presetKey: string) {
    const preset = NOTIFICATION_PRESETS.find((p) => p.key === presetKey);
    if (preset) saveChanges(diffSubscriptions(r.id, r.subscriptions, presetTypeKeys(preset, types), visibleKeys));
  }

  function teamBadge(r: TenantNotificationRecipient) {
    if (!r.admin_user_id) return null;
    const member = teamById.get(r.admin_user_id);
    if (member?.active) return <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><IconUsers size={12} aria-hidden="true" />Équipe</span>;
    return <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" title="Le compte admin lié est désactivé : aucune notification n’est envoyée.">Accès désactivé</span>;
  }

  /** Fine-grained controls of one recipient (expanded row on desktop, card body below xl). */
  function renderDetails(r: TenantNotificationRecipient) {
    const busy = saving.has(r.id);
    const preset = matchingPreset(r.subscriptions, types);
    const linkable = team.filter((member) => member.id === r.admin_user_id || !recipients.some((x) => x.admin_user_id === member.id));
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
            Profil
            <select className={SELECT_CLS} value={preset?.key ?? 'custom'} disabled={busy} onChange={(e) => applyPreset(r, e.target.value)}>
              <option value="custom" disabled>Personnalisé</option>
              {NOTIFICATION_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label} — {p.description}</option>)}
            </select>
          </label>
          {team.length > 0 && (
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Membre de l’équipe lié
              <select className={SELECT_CLS} value={r.admin_user_id ?? ''} disabled={busy} onChange={(e) => patchRecipient(r.id, { admin_user_id: e.target.value || null })}>
                <option value="">Aucun (email externe)</option>
                {linkable.map((member) => <option key={member.id} value={member.id}>{member.name ? `${member.name} · ${member.email}` : member.email}{member.active ? '' : ' (désactivé)'}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const state = groupState(r.subscriptions, group);
            return (
              <fieldset key={group.key}>
                <legend className="mb-1 flex w-full items-center gap-2">
                  <TriStateCheckbox checked={state.checked} indeterminate={state.indeterminate} disabled={busy} label={`${group.label} — tout — ${nameOf(r)}`} onChange={(next) => toggleGroup(r, group, next)} />
                  <span className={GROUP_LEGEND_CLS}>{group.label}</span>
                  <span className="text-xs text-gray-400">{state.count}/{state.total}</span>
                </legend>
                {group.items.map((item) => (
                  <label key={item.key} className="flex min-h-11 items-start gap-2.5 py-1 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" className={`${CHECKBOX_CLS} mt-0.5`} checked={r.subscriptions.includes(item.key)} disabled={busy}
                      onChange={(e) => saveChanges([{ recipientId: r.id, typeKey: item.key as NotificationTypeKey, subscribed: e.target.checked }])} />
                    <span>
                      <span className="block">{item.label}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{item.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
      </div>
    );
  }

  const deleteButton = (r: TenantNotificationRecipient) => (
    <button type="button" onClick={() => handleDelete(r)} disabled={saving.has(r.id)} aria-label={`Supprimer ${r.email}`} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] disabled:opacity-50 dark:hover:bg-red-950/30"><IconTrash size={17} /></button>
  );

  return (
    <>
      <SettingsPanel
        id="destinataires"
        title="Destinataires"
        description="Cochez un groupe pour tout recevoir, ou ouvrez un destinataire pour choisir type par type. Chaque modification est enregistrée immédiatement."
        aside={<SettingsFeedback feedback={feedback} />}
      >
        {recipients.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">Aucun destinataire configuré.</p>
        ) : (
          <>
            {/* Desktop: recipients × groups summary; details expand inline. */}
            <div className="-mx-4 hidden overflow-x-auto sm:-mx-6 xl:block">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <caption className="sr-only">Notifications reçues par destinataire</caption>
                <thead>
                  <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                    <th scope="col" className="px-6 pb-2 text-left align-bottom font-medium">Destinataire</th>
                    {groups.map((group) => {
                      const all = recipients.map((r) => groupState(r.subscriptions, group));
                      const checked = all.every((s) => s.checked);
                      const some = all.some((s) => s.count > 0);
                      return (
                        <th key={group.key} scope="col" className="border-l border-gray-100 px-3 pb-2 text-center align-bottom font-semibold uppercase tracking-[0.08em] dark:border-gray-800">
                          <span className="block">{group.label}</span>
                          <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium normal-case tracking-normal" title={`${group.items.map((i) => i.label).join(', ')}`}>
                            <TriStateCheckbox checked={checked} indeterminate={!checked && some} disabled={saving.size > 0} label={`${group.label} — tous les destinataires`} onChange={(next) => toggleGroupForAll(group, next)} />
                            Tous
                          </span>
                        </th>
                      );
                    })}
                    <th scope="col" className="border-l border-gray-100 px-3 pb-2 text-center align-bottom font-medium dark:border-gray-800">Actif</th>
                    <th scope="col" className="px-6 pb-2 align-bottom"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                {recipients.map((r) => {
                  const busy = saving.has(r.id);
                  const open = expanded === r.id;
                  return (
                    <tbody key={r.id} className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
                      <tr className={r.active ? '' : 'text-gray-400'}>
                        <th scope="row" className="max-w-[260px] py-3 pl-6 pr-2 text-left font-normal">
                          <button type="button" onClick={() => setExpanded(open ? null : r.id)} aria-expanded={open} className="flex w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)]">
                            <IconChevronDown size={16} aria-hidden="true" className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                            <span className="min-w-0">
                              <span className={`flex items-center truncate font-medium ${r.active ? 'text-gray-950 dark:text-gray-100' : 'text-gray-500'}`}><span className="truncate">{nameOf(r)}</span>{teamBadge(r)}</span>
                              {r.label && <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{r.email}</span>}
                            </span>
                          </button>
                        </th>
                        {groups.map((group) => {
                          const state = groupState(r.subscriptions, group);
                          return (
                            <td key={group.key} className="border-l border-gray-100 px-3 text-center dark:border-gray-800">
                              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-gray-50 dark:hover:bg-white/5">
                                <TriStateCheckbox checked={state.checked} indeterminate={state.indeterminate} disabled={busy} label={`${group.label} — ${nameOf(r)}`} onChange={(next) => toggleGroup(r, group, next)} />
                                <span className="w-8 text-left text-xs tabular-nums text-gray-500 dark:text-gray-400">{state.count}/{state.total}</span>
                              </label>
                            </td>
                          );
                        })}
                        <td className="border-l border-gray-100 px-3 text-center dark:border-gray-800">
                          <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-gray-50 dark:hover:bg-white/5">
                            <span className="sr-only">{`Destinataire actif — ${nameOf(r)}`}</span>
                            <input type="checkbox" className={CHECKBOX_CLS} checked={r.active} disabled={busy} onChange={(e) => patchRecipient(r.id, { active: e.target.checked })} />
                          </label>
                        </td>
                        <td className="px-6 text-right">{deleteButton(r)}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={groups.length + 3} className="bg-gray-50/60 px-6 py-4 dark:bg-white/[0.02]">{renderDetails(r)}</td>
                        </tr>
                      )}
                    </tbody>
                  );
                })}
              </table>
            </div>

            {/* Below xl: one card per recipient. */}
            <ul className="grid gap-4 md:grid-cols-2 xl:hidden">
              {recipients.map((r) => (
                <li key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-800">
                  <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center truncate text-sm font-semibold text-gray-950 dark:text-gray-100"><span className="truncate">{nameOf(r)}</span>{teamBadge(r)}</p>
                      {r.label && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{r.email}</p>}
                    </div>
                    {deleteButton(r)}
                  </div>
                  <div className="space-y-3 px-4 py-3">
                    <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                      Destinataire actif
                      <input type="checkbox" className={CHECKBOX_CLS} checked={r.active} disabled={saving.has(r.id)} onChange={(e) => patchRecipient(r.id, { active: e.target.checked })} />
                    </label>
                    {renderDetails(r)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </SettingsPanel>

      <AddRecipientPanel
        types={types}
        groups={groups}
        team={team.filter((member) => !recipients.some((r) => r.admin_user_id === member.id))}
        onCreated={(created) => { setRecipients((prev) => [...prev, created]); showToast('Destinataire ajouté', 'success'); }}
        onError={(message) => showToast(message, 'error')}
      />
    </>
  );
}

function AddRecipientPanel({ types, groups, team, onCreated, onError }: {
  types: NotificationTypeDefinition[];
  groups: Group[];
  team: NotificationTeamMember[];
  onCreated: (recipient: TenantNotificationRecipient) => void;
  onError: (message: string) => void;
}) {
  const initial = () => ({ email: '', label: '', adminUserId: '', subscriptions: defaultNotificationTypeKeys(types) as string[] });
  const [form, setForm] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);
  const activePreset = matchingPreset(form.subscriptions, types);

  function pickMember(id: string) {
    const member = team.find((m) => m.id === id);
    setForm((prev) => ({ ...prev, adminUserId: id, email: member?.email ?? prev.email, label: member?.name ?? prev.label }));
  }

  const toggle = (key: string, on: boolean) => setForm((prev) => ({ ...prev, subscriptions: on ? [...prev.subscriptions, key] : prev.subscriptions.filter((k) => k !== key) }));

  async function handleCreate() {
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/notification-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, label: form.label, admin_user_id: form.adminUserId || null, subscriptions: form.subscriptions }),
      });
      const body = await res.json().catch(() => null) as (TenantNotificationRecipient & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? 'Erreur lors de l’ajout');
      onCreated(body);
      setForm(initial());
    } catch (err) { onError(err instanceof Error ? err.message : 'Erreur lors de l’ajout'); } finally { setIsSaving(false); }
  }

  return (
    <SettingsPanel id="ajouter" title="Ajouter un destinataire" description="Un membre de l’équipe ou une adresse externe. Choisissez un profil puis ajustez si besoin.">
      {team.length > 0 && (
        <div className="mb-4">
          <label htmlFor="recipient-new-member" className={SETTINGS_LABEL_CLS}>Depuis l’équipe</label>
          <select id="recipient-new-member" className={`${SELECT_CLS} w-full`} value={form.adminUserId} onChange={(e) => pickMember(e.target.value)}>
            <option value="">Adresse externe (hors équipe)</option>
            {team.map((member) => <option key={member.id} value={member.id}>{member.name ? `${member.name} · ${member.email}` : member.email}{member.active ? '' : ' (désactivé)'}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Lié à l’équipe, le destinataire cesse de recevoir les notifications si son accès admin est désactivé.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="recipient-new-email" className={SETTINGS_LABEL_CLS}>Email</label>
          <input id="recipient-new-email" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@boutique.com" className={SETTINGS_INPUT_CLS} />
        </div>
        <div>
          <label htmlFor="recipient-new-label" className={SETTINGS_LABEL_CLS}>Étiquette</label>
          <input id="recipient-new-label" type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex : Cuisine" className={SETTINGS_INPUT_CLS} />
        </div>
      </div>

      <div className="mt-5">
        <p className={SETTINGS_LABEL_CLS}>Profil</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Profils de notifications">
          {NOTIFICATION_PRESETS.map((preset) => {
            const on = activePreset?.key === preset.key;
            return (
              <button key={preset.key} type="button" aria-pressed={on} title={preset.description}
                onClick={() => setForm((prev) => ({ ...prev, subscriptions: presetTypeKeys(preset, types) }))}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${on ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5'}`}>
                {preset.label}
              </button>
            );
          })}
          {!activePreset && <span className="inline-flex min-h-11 items-center px-2 text-sm text-gray-500">Personnalisé</span>}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {groups.map((group) => (
          <fieldset key={group.key}>
            <legend className={`mb-1 ${GROUP_LEGEND_CLS}`}>{group.label}</legend>
            {group.items.map((item) => (
              <label key={item.key} className="flex min-h-11 items-center gap-2.5 text-sm text-gray-700 dark:text-gray-300" title={item.description}>
                <input type="checkbox" className={CHECKBOX_CLS} checked={form.subscriptions.includes(item.key)} onChange={(e) => toggle(item.key, e.target.checked)} />
                {item.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <Button type="button" onClick={handleCreate} loading={isSaving} disabled={!form.email.trim()} className="mt-4 min-h-11">{!isSaving && <IconPlus size={16} aria-hidden="true" />}Ajouter le destinataire</Button>
    </SettingsPanel>
  );
}
