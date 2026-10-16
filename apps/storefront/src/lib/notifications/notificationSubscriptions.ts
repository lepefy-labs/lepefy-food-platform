import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationTeamMember, TenantNotificationRecipient } from '@lepefy/types';
import {
  applySubscriptionChanges, changeChannel, type NotificationChannel, type NotificationSubscriptionChange,
} from '@/lib/notifications/notificationTypes';

const RECIPIENT_COLUMNS = 'id, tenant_id, email, label, admin_user_id, active, created_at, whatsapp_phone, whatsapp_verified_at';

type RecipientRow = Omit<TenantNotificationRecipient, 'subscriptions' | 'whatsapp_subscriptions'>;

async function attachSubscriptions(db: SupabaseClient, tenantId: string, rows: RecipientRow[]): Promise<TenantNotificationRecipient[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db.from('tenant_notification_subscriptions')
    .select('recipient_id, type_key, channel')
    .eq('tenant_id', tenantId)
    .in('recipient_id', rows.map((row) => row.id));
  if (error) throw error;
  const byTarget = new Map<string, string[]>();
  for (const sub of (data ?? []) as Array<{ recipient_id: string; type_key: string; channel: string }>) {
    const key = `${sub.recipient_id}:${sub.channel}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), sub.type_key]);
  }
  return rows.map((row) => ({
    ...row,
    subscriptions: applySubscriptionChanges(row.id, byTarget.get(`${row.id}:email`) ?? [], []),
    whatsapp_subscriptions: applySubscriptionChanges(row.id, byTarget.get(`${row.id}:whatsapp`) ?? [], [], 'whatsapp'),
  }));
}

/** Recipients of a tenant with their email and WhatsApp subscriptions, oldest first. */
export async function loadNotificationRecipients(db: SupabaseClient, tenantId: string, ids?: string[]): Promise<TenantNotificationRecipient[]> {
  let query = db.from('tenant_notification_recipients').select(RECIPIENT_COLUMNS).eq('tenant_id', tenantId);
  if (ids) query = query.in('id', ids);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw error;
  return attachSubscriptions(db, tenantId, (data ?? []) as RecipientRow[]);
}

/** Team members of the tenant (any membership state), for linking recipients. */
export async function loadNotificationTeamMembers(db: SupabaseClient, tenantId: string): Promise<NotificationTeamMember[]> {
  const { data: memberships, error } = await db.from('admin_memberships').select('user_id, active').eq('tenant_id', tenantId);
  if (error) throw error;
  const membershipActive = new Map<string, boolean>();
  for (const row of (memberships ?? []) as Array<{ user_id: string; active: boolean }>) {
    membershipActive.set(row.user_id, (membershipActive.get(row.user_id) ?? false) || row.active);
  }
  if (membershipActive.size === 0) return [];
  const { data: users, error: usersError } = await db.from('admin_users')
    .select('id, email, first_name, last_name, nickname, active')
    .in('id', Array.from(membershipActive.keys()))
    .order('email', { ascending: true });
  if (usersError) throw usersError;
  return ((users ?? []) as Array<{ id: string; email: string; first_name: string | null; last_name: string | null; nickname: string | null; active: boolean }>)
    .map((user) => ({
      id: user.id,
      email: user.email,
      name: user.nickname?.trim() || [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null,
      active: user.active && membershipActive.get(user.id) === true,
    }));
}

/** True when `adminUserId` is a member of the tenant. */
export async function isTenantTeamMember(db: SupabaseClient, tenantId: string, adminUserId: string): Promise<boolean> {
  const { data, error } = await db.from('admin_memberships').select('id').eq('tenant_id', tenantId).eq('user_id', adminUserId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Applies subscription changes (any channel) for recipients of this tenant.
 * Recipient ids are checked against the tenant first; unknown ids fail the
 * whole batch. Returns the canonical recipients touched, or null when an id is
 * foreign.
 */
export async function applyNotificationSubscriptionChanges(
  db: SupabaseClient,
  tenantId: string,
  changes: NotificationSubscriptionChange[],
): Promise<TenantNotificationRecipient[] | null> {
  const recipientIds = Array.from(new Set(changes.map((change) => change.recipientId)));
  const { data: owned, error: ownedError } = await db.from('tenant_notification_recipients')
    .select('id').eq('tenant_id', tenantId).in('id', recipientIds);
  if (ownedError) throw ownedError;
  if ((owned ?? []).length !== recipientIds.length) return null;

  // Last change wins when the same (recipient, type, channel) appears twice.
  const finalState = new Map<string, NotificationSubscriptionChange>();
  for (const change of changes) finalState.set(`${change.recipientId}:${change.typeKey}:${changeChannel(change)}`, change);
  const additions = Array.from(finalState.values()).filter((change) => change.subscribed);
  const removals = Array.from(finalState.values()).filter((change) => !change.subscribed);

  if (additions.length > 0) {
    const { error } = await db.from('tenant_notification_subscriptions').upsert(
      additions.map((change) => ({ tenant_id: tenantId, recipient_id: change.recipientId, type_key: change.typeKey, channel: changeChannel(change) })),
      { onConflict: 'recipient_id,type_key,channel', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const removalsByTarget = new Map<string, { recipientId: string; channel: NotificationChannel; typeKeys: string[] }>();
  for (const change of removals) {
    const key = `${change.recipientId}:${changeChannel(change)}`;
    const entry = removalsByTarget.get(key) ?? { recipientId: change.recipientId, channel: changeChannel(change), typeKeys: [] };
    entry.typeKeys.push(change.typeKey);
    removalsByTarget.set(key, entry);
  }
  for (const { recipientId, channel, typeKeys } of Array.from(removalsByTarget.values())) {
    const { error } = await db.from('tenant_notification_subscriptions').delete()
      .eq('tenant_id', tenantId).eq('recipient_id', recipientId).eq('channel', channel).in('type_key', typeKeys);
    if (error) throw error;
  }

  return loadNotificationRecipients(db, tenantId, recipientIds);
}

/** Active, deliverable subscribers per type key on a channel (health page). */
export async function countSubscribersByType(db: SupabaseClient, tenantId: string, channel: NotificationChannel = 'email'): Promise<Record<string, number>> {
  const [recipients, team] = await Promise.all([loadNotificationRecipients(db, tenantId), loadNotificationTeamMembers(db, tenantId)]);
  const teamActive = new Map(team.map((member) => [member.id, member.active]));
  const counts: Record<string, number> = {};
  for (const recipient of recipients) {
    if (!recipient.active || (recipient.admin_user_id && teamActive.get(recipient.admin_user_id) !== true)) continue;
    const deliverable = channel === 'email' ? !!recipient.email : !!recipient.whatsapp_phone && !!recipient.whatsapp_verified_at;
    if (!deliverable) continue;
    for (const key of channel === 'email' ? recipient.subscriptions : recipient.whatsapp_subscriptions) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
