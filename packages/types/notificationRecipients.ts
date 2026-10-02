export interface TenantNotificationRecipient {
  id: string;
  tenant_id: string;
  email: string;
  label: string | null;
  /** Optional team member link (admin_users.id); see migration 143. */
  admin_user_id: string | null;
  active: boolean;
  created_at: string;
  /**
   * Subscribed notification type keys (email channel), from
   * tenant_notification_subscriptions. Catalogue:
   * apps/storefront/src/lib/notifications/notificationTypes.ts.
   */
  subscriptions: string[];
}

/** Team member that can be linked to a recipient (admin_users ∩ tenant membership). */
export interface NotificationTeamMember {
  id: string;
  email: string;
  name: string | null;
  /** Admin account active and membership of this tenant active. */
  active: boolean;
}
