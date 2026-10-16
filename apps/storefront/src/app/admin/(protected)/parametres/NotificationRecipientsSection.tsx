'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '@/app/admin/_components/ui/ConfirmDialog';
import { IconBrandWhatsapp, IconChevronDown, IconMail, IconPencil, IconPlus, IconSend, IconSparkles, IconTrash, IconUsers } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import Badge from '../../_components/ui/Badge';
import Dialog from '../../_components/ui/Dialog';
import InlineAlert from '../../_components/ui/InlineAlert';
import { FormField, Input, Select } from '../../_components/ui/Form';
import type { NotificationTeamMember, TenantNotificationRecipient } from '@lepefy/types';
import {
  NOTIFICATION_PRESETS,
  NOTIFICATION_TYPES,
  RECOMMENDED_SUBSCRIPTIONS,
  applySubscriptionChanges,
  defaultNotificationTypeKeys,
  diffSubscriptions,
  groupNotificationTypes,
  matchingPreset,
  presetTypeKeys,
  type NotificationChannel,
  type NotificationSubscriptionChange,
  type NotificationTypeDefinition,
  type NotificationTypeKey,
} from '@/lib/notifications/notificationTypes';
import { formatWhatsappPhone, normalizeWhatsappPhone } from '@/lib/notifications/staff/staffWhatsapp';
import { SettingsFeedback, SettingsPanel, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

// Catalogue, channels, defaults and profiles come from
// lib/notifications/notificationTypes.ts: a new type appears here by itself.

type Group = ReturnType<typeof groupNotificationTypes>[number];

export interface WhatsappChannelStatus {
  /** Release flag staff_whatsapp_notifications on this tenant. */
  enabled: boolean;
  /** Green API credentials present on the deployment. */
  configured: boolean;
}

const CHECKBOX_CLS = 'h-5 w-5 cursor-pointer accent-[var(--admin-primary)] disabled:cursor-not-allowed disabled:opacity-40';
const SELECT_CLS = 'min-h-11 rounded-lg border border-a-field bg-a-surface px-3 text-sm text-a-text';
const GROUP_LEGEND_CLS = 'text-xs font-semibold uppercase tracking-[0.08em] text-a-text-3';

function TriStateCheckbox({ checked, indeterminate, label, disabled, onChange }: { checked: boolean; indeterminate: boolean; label: string; disabled?: boolean; onChange: (next: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" aria-label={label} className={CHECKBOX_CLS} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

function subsOf(r: TenantNotificationRecipient, channel: NotificationChannel): string[] {
  return channel === 'email' ? r.subscriptions : r.whatsapp_subscriptions;
}

function channelReady(r: TenantNotificationRecipient, channel: NotificationChannel): boolean {
  return channel === 'email' ? !!r.email : !!r.whatsapp_phone;
}

function supported(item: NotificationTypeDefinition, channel: NotificationChannel) {
  return item.channels.includes(channel);
}

function nameOf(r: TenantNotificationRecipient) {
  return r.label || r.email || (r.whatsapp_phone ? formatWhatsappPhone(r.whatsapp_phone) : 'Destinataire');
}

function whatsappBadge(r: TenantNotificationRecipient) {
  if (!r.whatsapp_phone) return <Badge tone="neutral">Aucun numéro</Badge>;
  if (r.whatsapp_verified_at) return <Badge tone="success" dot>Numéro confirmé</Badge>;
  return <Badge tone="warning" dot>À confirmer</Badge>;
}

export function NotificationRecipientsSection({ initialRecipients, team, typeKeys, whatsapp }: {
  initialRecipients: TenantNotificationRecipient[];
  team: NotificationTeamMember[];
  typeKeys: string[];
  whatsapp: WhatsappChannelStatus;
}) {
  const types = useMemo<NotificationTypeDefinition[]>(() => (NOTIFICATION_TYPES as ReadonlyArray<NotificationTypeDefinition>).filter((type) => typeKeys.includes(type.key)), [typeKeys]);
  const groups = useMemo(() => groupNotificationTypes(types), [types]);
  const visibleKeys = useMemo(() => types.map((type) => type.key as NotificationTypeKey), [types]);
  const teamById = useMemo(() => new Map(team.map((member) => [member.id, member])), [team]);

  const [recipients, setRecipients] = useState(initialRecipients);
  const [ask, confirmDialog] = useConfirm();
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(initialRecipients.length === 1 ? initialRecipients[0]!.id : null);
  const [editing, setEditing] = useState<TenantNotificationRecipient | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState<Set<string>>(new Set());
  const { feedback, show: showToast } = useSettingsFeedback();

  const markSaving = (ids: string[], on: boolean) => setSaving((prev) => {
    const next = new Set(prev);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  const replaceRecipient = (updated: TenantNotificationRecipient) => setRecipients((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));

  // Optimistic batch save; the server answer is canonical, errors roll back.
  async function saveChanges(changes: NotificationSubscriptionChange[]) {
    if (changes.length === 0) return;
    const ids = Array.from(new Set(changes.map((change) => change.recipientId)));
    const before = new Map(recipients.filter((r) => ids.includes(r.id)).map((r) => [r.id, { email: r.subscriptions, whatsapp: r.whatsapp_subscriptions }]));
    setRecipients((prev) => prev.map((r) => (ids.includes(r.id) ? {
      ...r,
      subscriptions: applySubscriptionChanges(r.id, r.subscriptions, changes),
      whatsapp_subscriptions: applySubscriptionChanges(r.id, r.whatsapp_subscriptions, changes, 'whatsapp'),
    } : r)));
    markSaving(ids, true);
    try {
      const res = await fetch('/api/admin/notification-recipients/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) });
      const body = await res.json().catch(() => null) as { error?: string; recipients?: Array<{ id: string; subscriptions: string[]; whatsapp_subscriptions: string[] }> } | null;
      if (!res.ok || !body?.recipients) throw new Error(body?.error ?? 'Erreur lors de l’enregistrement');
      const canonical = new Map(body.recipients.map((r) => [r.id, r]));
      setRecipients((prev) => prev.map((r) => {
        const next = canonical.get(r.id);
        return next ? { ...r, subscriptions: next.subscriptions, whatsapp_subscriptions: next.whatsapp_subscriptions } : r;
      }));
      showToast('Enregistré', 'success');
    } catch (err) {
      setRecipients((prev) => prev.map((r) => {
        const previous = before.get(r.id);
        return previous ? { ...r, subscriptions: previous.email, whatsapp_subscriptions: previous.whatsapp } : r;
      }));
      showToast(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement', 'error');
    } finally {
      markSaving(ids, false);
    }
  }

  async function patchRecipient(id: string, patch: Partial<Pick<TenantNotificationRecipient, 'active' | 'label' | 'admin_user_id' | 'email' | 'whatsapp_phone'>>): Promise<boolean> {
    const previous = recipients.find((r) => r.id === id);
    markSaving([id], true);
    try {
      const res = await fetch(`/api/admin/notification-recipients/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const body = await res.json().catch(() => null) as { error?: string; recipient?: TenantNotificationRecipient } | null;
      if (!res.ok) throw new Error(body?.error ?? 'Erreur lors de l’enregistrement');
      if (body?.recipient) replaceRecipient(body.recipient);
      showToast('Enregistré', 'success');
      return true;
    } catch (err) {
      if (previous) replaceRecipient(previous);
      showToast(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement', 'error');
      return false;
    } finally {
      markSaving([id], false);
    }
  }

  async function handleDelete(r: TenantNotificationRecipient) {
    if (!(await ask({ title: `Supprimer ${nameOf(r)} des destinataires ?`, description: 'Cette personne ne recevra plus aucune notification, ni par email ni par WhatsApp. L’historique des envois est conservé.', confirmLabel: 'Supprimer', destructive: true }))) return;
    markSaving([r.id], true);
    try {
      const res = await fetch(`/api/admin/notification-recipients/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setRecipients((prev) => prev.filter((x) => x.id !== r.id));
      showToast('Destinataire supprimé', 'success');
    } catch { showToast('Erreur lors de la suppression', 'error'); } finally { markSaving([r.id], false); }
  }

  async function sendTest(r: TenantNotificationRecipient, channel: NotificationChannel) {
    const label = channel === 'email' ? `l’email ${r.email}` : `le WhatsApp ${formatWhatsappPhone(r.whatsapp_phone)}`;
    if (!(await ask({ title: 'Envoyer un message de test ?', description: `Un message marqué [TEST] sera envoyé à ${label}, et uniquement à ce destinataire.`, confirmLabel: 'Envoyer le test' }))) return;
    setTesting(`${r.id}:${channel}`);
    try {
      const res = await fetch(`/api/admin/notification-recipients/${r.id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) });
      const body = await res.json().catch(() => null) as { accepted?: boolean; error?: string } | null;
      if (!res.ok || !body?.accepted) throw new Error(body?.error ?? 'Le test n’a pas pu être envoyé');
      if (channel === 'whatsapp') {
        setAwaitingConfirm((prev) => new Set(prev).add(r.id));
        showToast('Test WhatsApp envoyé : confirmez la réception quand il arrive.', 'success');
      } else showToast('Test envoyé : vérifiez la boîte de réception.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Le test n’a pas pu être envoyé', 'error');
    } finally { setTesting(null); }
  }

  async function confirmWhatsapp(r: TenantNotificationRecipient) {
    markSaving([r.id], true);
    try {
      const res = await fetch(`/api/admin/notification-recipients/${r.id}/whatsapp-confirm`, { method: 'POST' });
      const body = await res.json().catch(() => null) as { verifiedAt?: string; error?: string } | null;
      if (!res.ok || !body?.verifiedAt) throw new Error(body?.error ?? 'Confirmation impossible');
      replaceRecipient({ ...r, whatsapp_verified_at: body.verifiedAt });
      setAwaitingConfirm((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
      showToast('Numéro confirmé : les notifications WhatsApp cochées seront envoyées.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Confirmation impossible', 'error'); } finally { markSaving([r.id], false); }
  }

  function toggleGroup(r: TenantNotificationRecipient, group: Group, channel: NotificationChannel, next: boolean) {
    const current = subsOf(r, channel);
    saveChanges(group.items.filter((item) => supported(item, channel) && current.includes(item.key) !== next)
      .map((item) => ({ recipientId: r.id, typeKey: item.key as NotificationTypeKey, subscribed: next, ...(channel === 'email' ? {} : { channel }) })));
  }

  function applyPreset(r: TenantNotificationRecipient, presetKey: string) {
    const preset = NOTIFICATION_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    const target = presetTypeKeys(preset, types);
    saveChanges([
      ...(r.email ? diffSubscriptions(r.id, r.subscriptions, target, visibleKeys) : []),
      ...(r.whatsapp_phone ? diffSubscriptions(r.id, r.whatsapp_subscriptions, target, visibleKeys, 'whatsapp') : []),
    ]);
  }

  async function applyRecommended(r: TenantNotificationRecipient) {
    const lines = [
      r.email ? `Email : ${RECOMMENDED_SUBSCRIPTIONS.email.map(labelOf).join(', ')}` : null,
      r.whatsapp_phone ? `WhatsApp : ${RECOMMENDED_SUBSCRIPTIONS.whatsapp.map(labelOf).join(', ')}` : null,
    ].filter(Boolean).join(' · ');
    if (!(await ask({ title: `Appliquer la configuration recommandée à ${nameOf(r)} ?`, description: `Ajoute ${lines}. Les autres choix sont conservés.`, confirmLabel: 'Appliquer' }))) return;
    const add = (channel: NotificationChannel) => RECOMMENDED_SUBSCRIPTIONS[channel]
      .filter((key) => visibleKeys.includes(key) && !subsOf(r, channel).includes(key))
      .map((key) => ({ recipientId: r.id, typeKey: key, subscribed: true, ...(channel === 'email' ? {} : { channel }) }));
    saveChanges([...(r.email ? add('email') : []), ...(r.whatsapp_phone ? add('whatsapp') : [])]);
  }

  function teamBadge(r: TenantNotificationRecipient) {
    if (!r.admin_user_id) return null;
    const member = teamById.get(r.admin_user_id);
    if (member?.active) return <Badge tone="brand" icon={<IconUsers size={12} aria-hidden="true" />}>Équipe</Badge>;
    return <Badge tone="warning">Accès désactivé</Badge>;
  }

  /** Événement × Email × WhatsApp for one recipient. */
  function renderMatrix(r: TenantNotificationRecipient) {
    const busy = saving.has(r.id);
    const channels: Array<{ key: NotificationChannel; label: string; icon: JSX.Element }> = [
      { key: 'email', label: 'Email', icon: <IconMail size={16} aria-hidden="true" /> },
      { key: 'whatsapp', label: 'WhatsApp', icon: <IconBrandWhatsapp size={16} aria-hidden="true" /> },
    ];
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <caption className="sr-only">Notifications de {nameOf(r)} par canal</caption>
          <thead>
            <tr className="border-b border-a-border text-xs text-a-text-3">
              <th scope="col" className="py-2 pr-3 text-left font-medium">Événement</th>
              {channels.map((channel) => (
                <th key={channel.key} scope="col" className="w-24 px-2 py-2 text-center font-semibold">
                  <span className="inline-flex items-center gap-1">{channel.icon}{channel.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.key} className="border-b border-a-border last:border-b-0">
              <tr className="bg-a-surface-2">
                <th scope="rowgroup" className={`py-2 pr-3 text-left ${GROUP_LEGEND_CLS}`}>{group.label}</th>
                {channels.map((channel) => {
                  const items = group.items.filter((item) => supported(item, channel.key));
                  const count = items.filter((item) => subsOf(r, channel.key).includes(item.key)).length;
                  return (
                    <td key={channel.key} className="px-2 py-2 text-center">
                      {items.length > 0 && (
                        <TriStateCheckbox checked={count === items.length} indeterminate={count > 0 && count < items.length}
                          disabled={busy || !channelReady(r, channel.key)} label={`${group.label} — ${channel.label} — tout — ${nameOf(r)}`}
                          onChange={(next) => toggleGroup(r, group, channel.key, next)} />
                      )}
                    </td>
                  );
                })}
              </tr>
              {group.items.map((item) => (
                <tr key={item.key}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    <span className="block text-a-text">{item.label}</span>
                    <span className="block text-xs text-a-text-3">{item.description}</span>
                  </th>
                  {channels.map((channel) => (
                    <td key={channel.key} className="px-2 py-1.5 text-center">
                      {supported(item, channel.key) ? (
                        <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg hover:bg-a-hover">
                          <span className="sr-only">{`${item.label} — ${channel.label} — ${nameOf(r)}`}</span>
                          <input type="checkbox" className={CHECKBOX_CLS} checked={subsOf(r, channel.key).includes(item.key)}
                            disabled={busy || !channelReady(r, channel.key)}
                            onChange={(e) => saveChanges([{ recipientId: r.id, typeKey: item.key as NotificationTypeKey, subscribed: e.target.checked, ...(channel.key === 'email' ? {} : { channel: channel.key }) }])} />
                        </label>
                      ) : <span className="text-a-text-3" title="Non disponible sur ce canal">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    );
  }

  function renderRecipient(r: TenantNotificationRecipient) {
    const busy = saving.has(r.id);
    const open = expanded === r.id;
    const preset = matchingPreset(r.subscriptions, types);
    const waCount = r.whatsapp_subscriptions.filter((key) => visibleKeys.includes(key as NotificationTypeKey)).length;
    const emailCount = r.subscriptions.filter((key) => visibleKeys.includes(key as NotificationTypeKey)).length;
    const showConfirm = !!r.whatsapp_phone && !r.whatsapp_verified_at;
    return (
      <li key={r.id} className={`rounded-xl border border-a-border bg-a-surface ${r.active ? '' : 'opacity-75'}`}>
        <div className="flex flex-wrap items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-a-text"><span className="truncate">{nameOf(r)}</span>{teamBadge(r)}{!r.active && <Badge tone="neutral">Inactif</Badge>}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-a-text-3">
              <span className="inline-flex items-center gap-1"><IconMail size={14} aria-hidden="true" />{r.email ?? 'Pas d’email'}</span>
              <span className="inline-flex items-center gap-1"><IconBrandWhatsapp size={14} aria-hidden="true" />{r.whatsapp_phone ? formatWhatsappPhone(r.whatsapp_phone) : 'Pas de WhatsApp'}</span>
              {whatsappBadge(r)}
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-a-text-2">
            Actif
            <input type="checkbox" className={CHECKBOX_CLS} checked={r.active} disabled={busy} onChange={(e) => patchRecipient(r.id, { active: e.target.checked })} />
          </label>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setEditing(r)} disabled={busy}><IconPencil size={16} aria-hidden="true" />Modifier</Button>
          <button type="button" onClick={() => handleDelete(r)} disabled={busy} aria-label={`Supprimer ${nameOf(r)}`} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-a-text-3 hover:bg-tone-danger-bg hover:text-tone-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus disabled:opacity-50"><IconTrash size={17} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-a-border px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-medium text-a-text-3">
            Profil
            <select className={SELECT_CLS} value={preset?.key ?? 'custom'} disabled={busy} onChange={(e) => applyPreset(r, e.target.value)}>
              <option value="custom" disabled>Personnalisé</option>
              {NOTIFICATION_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label} — {p.description}</option>)}
            </select>
          </label>
          <Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => applyRecommended(r)}><IconSparkles size={16} aria-hidden="true" />Configuration recommandée</Button>
          {r.email && <Button variant="outline" size="sm" className="min-h-11" loading={testing === `${r.id}:email`} disabled={busy || !!testing} onClick={() => sendTest(r, 'email')}>{testing !== `${r.id}:email` && <IconSend size={16} aria-hidden="true" />}Tester l’email</Button>}
          {r.whatsapp_phone && <Button variant="outline" size="sm" className="min-h-11" loading={testing === `${r.id}:whatsapp`} disabled={busy || !!testing || !whatsapp.configured} onClick={() => sendTest(r, 'whatsapp')}>{testing !== `${r.id}:whatsapp` && <IconBrandWhatsapp size={16} aria-hidden="true" />}Tester WhatsApp</Button>}
          {showConfirm && <Button variant={awaitingConfirm.has(r.id) ? 'primary' : 'secondary'} size="sm" className="min-h-11" disabled={busy} onClick={() => confirmWhatsapp(r)}>J’ai reçu le message de test</Button>}
          <button type="button" onClick={() => setExpanded(open ? null : r.id)} aria-expanded={open} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-a-brand-fg hover:bg-a-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus">
            Email {emailCount} · WhatsApp {waCount}
            <IconChevronDown size={16} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {showConfirm && (
          <p className="border-t border-a-border px-4 py-2 text-xs text-a-text-3">Numéro à confirmer : envoyez un test, puis cliquez « J’ai reçu le message de test ». Aucun message WhatsApp automatique n’est envoyé avant.</p>
        )}
        {open && <div className="border-t border-a-border px-4 py-3">{renderMatrix(r)}</div>}
      </li>
    );
  }

  return (
    <>
      {confirmDialog}
      <SettingsPanel
        id="destinataires"
        title="Destinataires"
        description="Pour chaque personne, choisissez les événements reçus par email et par WhatsApp. Chaque modification est enregistrée immédiatement."
        aside={<SettingsFeedback feedback={feedback} />}
      >
        <div className="mb-4">
          {whatsapp.enabled ? (
            <InlineAlert tone="success" title="WhatsApp actif">Les messages partent du numéro WhatsApp Lepefy vers le numéro confirmé de chaque destinataire. Ils ne sont jamais envoyés aux clients.</InlineAlert>
          ) : (
            <InlineAlert tone="info" title="WhatsApp en préparation">Vous pouvez déjà saisir et tester les numéros. Les notifications WhatsApp automatiques démarreront quand Lepefy activera le canal pour votre boutique.</InlineAlert>
          )}
          {!whatsapp.configured && <InlineAlert tone="warning" className="mt-2" title="Service WhatsApp Lepefy indisponible">Les tests WhatsApp sont désactivés sur ce déploiement.</InlineAlert>}
        </div>
        {recipients.length === 0 ? (
          <p className="rounded-xl border border-dashed border-a-border p-4 text-sm text-a-text-3">Aucun destinataire configuré.</p>
        ) : (
          <ul className="space-y-3">{recipients.map(renderRecipient)}</ul>
        )}
      </SettingsPanel>

      <AddRecipientPanel
        types={types}
        groups={groups}
        team={team.filter((member) => !recipients.some((r) => r.admin_user_id === member.id))}
        onCreated={(created) => { setRecipients((prev) => [...prev, created]); setExpanded(created.id); showToast('Destinataire ajouté', 'success'); }}
        onError={(message) => showToast(message, 'error')}
      />

      {editing && (
        <EditRecipientDialog
          recipient={editing}
          team={team.filter((member) => member.id === editing.admin_user_id || !recipients.some((x) => x.admin_user_id === member.id))}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { if (await patchRecipient(editing.id, patch)) setEditing(null); }}
          saving={saving.has(editing.id)}
        />
      )}
    </>
  );
}

function labelOf(key: string) {
  return (NOTIFICATION_TYPES as ReadonlyArray<NotificationTypeDefinition>).find((type) => type.key === key)?.short ?? key;
}

function EditRecipientDialog({ recipient, team, onClose, onSave, saving }: {
  recipient: TenantNotificationRecipient;
  team: NotificationTeamMember[];
  onClose: () => void;
  onSave: (patch: Partial<Pick<TenantNotificationRecipient, 'label' | 'email' | 'whatsapp_phone' | 'admin_user_id'>>) => void;
  saving: boolean;
}) {
  const [label, setLabel] = useState(recipient.label ?? '');
  const [email, setEmail] = useState(recipient.email ?? '');
  const [phone, setPhone] = useState(recipient.whatsapp_phone ? formatWhatsappPhone(recipient.whatsapp_phone) : '');
  const [member, setMember] = useState(recipient.admin_user_id ?? '');
  const normalized = phone.trim() ? normalizeWhatsappPhone(phone) : null;
  const phoneError = phone.trim() && !normalized ? 'Format international avec indicatif, ex. +39 333 123 4567.' : null;
  const phoneChanged = (normalized ?? null) !== (recipient.whatsapp_phone ?? null);
  const empty = !email.trim() && !phone.trim();
  return (
    <Dialog open onClose={onClose} title={`Modifier ${recipient.label || recipient.email || 'le destinataire'}`} dismissible={!saving} size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
        <Button type="submit" form="edit-recipient" loading={saving} disabled={!!phoneError || empty}>Enregistrer</Button>
      </>}>
      <form id="edit-recipient" className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        onSave({ label: label.trim() || null, email: email.trim() || null, whatsapp_phone: normalized, admin_user_id: member || null });
      }}>
        <FormField label="Étiquette" optional><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex : Cuisine" /></FormField>
        <FormField label="Email" optional><Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@boutique.com" /></FormField>
        <FormField label="Numéro WhatsApp" optional error={phoneError}
          hint={phoneChanged && normalized ? 'Nouveau numéro : il faudra le confirmer avec un message de test.' : 'Le numéro personnel du destinataire, jamais celui de la boutique.'}>
          <Input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 333 123 4567" />
        </FormField>
        {team.length > 0 && (
          <FormField label="Membre de l’équipe lié" hint="Lié à l’équipe, le destinataire cesse de recevoir les notifications si son accès admin est désactivé.">
            <Select value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">Aucun (destinataire externe)</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name ? `${m.name} · ${m.email}` : m.email}{m.active ? '' : ' (désactivé)'}</option>)}
            </Select>
          </FormField>
        )}
        {empty && <p className="text-sm text-tone-danger-fg">Gardez au moins un email ou un numéro WhatsApp.</p>}
      </form>
    </Dialog>
  );
}

function AddRecipientPanel({ types, groups, team, onCreated, onError }: {
  types: NotificationTypeDefinition[];
  groups: Group[];
  team: NotificationTeamMember[];
  onCreated: (recipient: TenantNotificationRecipient) => void;
  onError: (message: string) => void;
}) {
  const initial = () => ({ email: '', phone: '', label: '', adminUserId: '', subscriptions: defaultNotificationTypeKeys(types) as string[] });
  const [form, setForm] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);
  const activePreset = matchingPreset(form.subscriptions, types);
  const normalized = form.phone.trim() ? normalizeWhatsappPhone(form.phone) : null;
  const phoneError = form.phone.trim() && !normalized ? 'Format international avec indicatif, ex. +39 333 123 4567.' : null;

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
        body: JSON.stringify({ email: form.email, whatsapp_phone: normalized, label: form.label, admin_user_id: form.adminUserId || null, subscriptions: form.email.trim() ? form.subscriptions : [] }),
      });
      const body = await res.json().catch(() => null) as (TenantNotificationRecipient & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? 'Erreur lors de l’ajout');
      onCreated(body);
      setForm(initial());
    } catch (err) { onError(err instanceof Error ? err.message : 'Erreur lors de l’ajout'); } finally { setIsSaving(false); }
  }

  const emailTypes = groups.map((group) => ({ ...group, items: group.items.filter((item) => item.channels.includes('email')) })).filter((group) => group.items.length > 0);

  return (
    <SettingsPanel id="ajouter" title="Ajouter un destinataire" description="Un membre de l’équipe ou une personne externe, avec un email, un numéro WhatsApp ou les deux. Les notifications WhatsApp se choisissent après confirmation du numéro.">
      {team.length > 0 && (
        <div className="mb-4">
          <label htmlFor="recipient-new-member" className={SETTINGS_LABEL_CLS}>Depuis l’équipe</label>
          <select id="recipient-new-member" className={`${SELECT_CLS} w-full`} value={form.adminUserId} onChange={(e) => pickMember(e.target.value)}>
            <option value="">Personne externe (hors équipe)</option>
            {team.map((member) => <option key={member.id} value={member.id}>{member.name ? `${member.name} · ${member.email}` : member.email}{member.active ? '' : ' (désactivé)'}</option>)}
          </select>
          <p className="mt-1 text-xs text-a-text-3">Lié à l’équipe, le destinataire cesse de recevoir les notifications si son accès admin est désactivé.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="recipient-new-email" className={SETTINGS_LABEL_CLS}>Email</label>
          <input id="recipient-new-email" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contact@boutique.com" className={SETTINGS_INPUT_CLS} />
        </div>
        <div>
          <label htmlFor="recipient-new-phone" className={SETTINGS_LABEL_CLS}>Numéro WhatsApp</label>
          <input id="recipient-new-phone" type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+39 333 123 4567" aria-invalid={!!phoneError} aria-describedby="recipient-new-phone-hint" className={SETTINGS_INPUT_CLS} />
          <p id="recipient-new-phone-hint" className={`mt-1 text-xs ${phoneError ? 'text-tone-danger-fg' : 'text-a-text-3'}`}>{phoneError ?? 'Numéro personnel, avec l’indicatif du pays.'}</p>
        </div>
        <div>
          <label htmlFor="recipient-new-label" className={SETTINGS_LABEL_CLS}>Étiquette</label>
          <input id="recipient-new-label" type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex : Cuisine" className={SETTINGS_INPUT_CLS} />
        </div>
      </div>

      {form.email.trim() && (
        <>
          <div className="mt-5">
            <p className={SETTINGS_LABEL_CLS}>Profil email</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Profils de notifications">
              {NOTIFICATION_PRESETS.map((preset) => {
                const on = activePreset?.key === preset.key;
                return (
                  <button key={preset.key} type="button" aria-pressed={on} title={preset.description}
                    onClick={() => setForm((prev) => ({ ...prev, subscriptions: presetTypeKeys(preset, types) }))}
                    className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${on ? 'border-a-brand bg-a-brand-soft text-a-brand-fg' : 'border-a-border text-a-text-2 hover:bg-a-surface-2'}`}>
                    {preset.label}
                  </button>
                );
              })}
              {!activePreset && <span className="inline-flex min-h-11 items-center px-2 text-sm text-a-text-3">Personnalisé</span>}
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {emailTypes.map((group) => (
              <fieldset key={group.key}>
                <legend className={`mb-1 ${GROUP_LEGEND_CLS}`}>{group.label}</legend>
                {group.items.map((item) => (
                  <label key={item.key} className="flex min-h-11 items-center gap-2.5 text-sm text-a-text-2" title={item.description}>
                    <input type="checkbox" className={CHECKBOX_CLS} checked={form.subscriptions.includes(item.key)} onChange={(e) => toggle(item.key, e.target.checked)} />
                    {item.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </>
      )}
      <Button type="button" onClick={handleCreate} loading={isSaving} disabled={(!form.email.trim() && !normalized) || !!phoneError} className="mt-4 min-h-11">{!isSaving && <IconPlus size={16} aria-hidden="true" />}Ajouter le destinataire</Button>
    </SettingsPanel>
  );
}
