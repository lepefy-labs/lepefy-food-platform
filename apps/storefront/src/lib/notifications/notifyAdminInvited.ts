import { randomUUID } from 'crypto';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { deliverEmail } from '@/lib/notifications/sendEmail';
import { adminInvitedEmail, PLATFORM_EMAIL_CONTEXT } from '@/lib/notifications/customerEmails';

interface NotifyAdminInvitedParams {
  email: string;
  role: string;
  tenantName: string;
  invitedByEmail: string;
  loginUrl: string;
}

// Email plateforme (expéditeur « Lepefy Food Platform »), rendu in-app et
// envoyé via send-email : best-effort, un échec ici ne doit jamais faire
// échouer la création de l'admin, déjà écrite en base à ce point.
export async function notifyAdminInvited(params: NotifyAdminInvitedParams): Promise<void> {
  await deliverEmail(PLATFORM_EMAIL_CONTEXT, {
    ...adminInvitedEmail(params),
    notificationType: 'admin_invited',
    idempotencyKey: `admin-invited:${randomUUID()}`,
    recipients: [params.email],
  }, notifyN8n, false);
}
