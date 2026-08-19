import { notifyN8n } from '@/lib/events/notifyN8n';

interface NotifyAdminInvitedParams {
  email: string;
  role: string;
  tenantName: string;
  invitedByEmail: string;
  loginUrl: string;
}

// Réutilise le canal n8n existant (notifyN8n, N8N_WEBHOOK_URL — voir
// resendReservationConfirmation.ts) : best-effort, un échec ici ne doit
// jamais faire échouer la création de l'admin, déjà écrite en base à ce
// point. Le webhook '/webhook/admin-invited' n'existe pas encore côté n8n —
// à créer manuellement (trigger + template email Brevo), hors scope Claude
// Code.
export async function notifyAdminInvited(params: NotifyAdminInvitedParams): Promise<void> {
  await notifyN8n('/webhook/admin-invited', { ...params });
}
