import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationTeamMember, TenantNotificationRecipient } from '@lepefy/types';
import { applySubscriptionChanges, type NotificationSubscriptionChange } from '@/lib/notifications/notificationTypes';

const RECIPIENT_COLUMNS = 'id, tenant_id, email, label, admin_user_id, active, created_at';

type RecipientRow = Omit<TenantNotificationRecipient, 'subscriptions'>;

async function attachSubscriptions(db: SupabaseClient, tenantId: string, rows: RecipientRow[]): Promise<TenantNotificationRecipient[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db.from('tenant_notification_subscriptions')
    .select('recipient_id, type_key')
    .eq('tenant_id', tenantId)
    .eq('channel', 'email')
    .in('recipient_id', rows.map((row) => row.id));
  if (error) throw error;
  const byRecipient = new Map<string, string[]>();
  for (const sub of (data ?? []) as Array<{ recipient_id: string; type_key: string }>) {
    byRecipient.set(sub.recipient_id, [...(byRecipient.get(sub.recipient_id) ?? []), sub.type_key]);
  }
  return rows.map((row) => ({ ...row, subscriptions: applySubscriptionChanges(row.id, byRecipient.get(row.id) ?? [], []) }));
}

/** Recipients of a tenant with their email subscriptions, oldest first. */
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
 * Applies subscription changes for recipients of this tenant. Recipient ids are
 * checked against the tenant first; unknown ids fail the whole batch.
 * Returns the canonical recipients touched, or null when an id is foreign.
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

  // Last change wins when the same (recipient, type) appears twice.
  const finalState = new Map<string, NotificationSubscriptionChange>();
  for (const change of changes) finalState.set(`${change.recipientId}:${change.typeKey}`, change);
  const additions = Array.from(finalState.values()).filter((change) => change.subscribed);
  const removals = Array.from(finalState.values()).filter((change) => !change.subscribed);

  if (additions.length > 0) {
    const { error } = await db.from('tenant_notification_subscriptions').upsert(
      additions.map((change) => ({ tenant_id: tenantId, recipient_id: change.recipientId, type_key: change.typeKey, channel: 'email' })),
      { onConflict: 'recipient_id,type_key,channel', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const removalsByRecipient = new Map<string, string[]>();
  for (const change of removals) removalsByRecipient.set(change.recipientId, [...(removalsByRecipient.get(change.recipientId) ?? []), change.typeKey]);
  for (const [recipientId, typeKeys] of Array.from(removalsByRecipient)) {
    const { error } = await db.from('tenant_notification_subscriptions').delete()
      .eq('tenant_id', tenantId).eq('recipient_id', recipientId).eq('channel', 'email').in('type_key', typeKeys);
    if (error) throw error;
  }

  return loadNotificationRecipients(db, tenantId, recipientIds);
}

/** Active, deliverable subscribers per type key (health page). */
export async function countSubscribersByType(db: SupabaseClient, tenantId: string): Promise<Record<string, number>> {
  const [recipients, team] = await Promise.all([loadNotificationRecipients(db, tenantId), loadNotificationTeamMembers(db, tenantId)]);
  const teamActive = new Map(team.map((member) => [member.id, member.active]));
  const counts: Record<string, number> = {};
  for (const recipient of recipients) {
    if (!recipient.active || (recipient.admin_user_id && teamActive.get(recipient.admin_user_id) !== true)) continue;
    for (const key of recipient.subscriptions) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
