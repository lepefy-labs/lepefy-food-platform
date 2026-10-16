export interface TenantNotificationRecipient {
  id: string;
  tenant_id: string;
  /** Null for a WhatsApp-only recipient (migration 158). */
  email: string | null;
  label: string | null;
  /** Optional team member link (admin_users.id); see migration 143. */
  admin_user_id: string | null;
  active: boolean;
  created_at: string;
  /** Recipient's own WhatsApp number, E.164 (+393…); null when unused. Migration 158. */
  whatsapp_phone: string | null;
  /** Reception of a test message confirmed; without it nothing is sent on WhatsApp. */
  whatsapp_verified_at: string | null;
  /**
   * Subscribed notification type keys on the email channel, from
   * tenant_notification_subscriptions. Catalogue:
   * apps/storefront/src/lib/notifications/notificationTypes.ts.
   */
  subscriptions: string[];
  /** Same, on the WhatsApp channel (opt-in, empty by default). */
  whatsapp_subscriptions: string[];
}

/** Team member that can be linked to a recipient (admin_users ∩ tenant membership). */
export interface NotificationTeamMember {
  id: string;
  email: string;
  name: string | null;
  /** Admin account active and membership of this tenant active. */
  active: boolean;
}
