import { notifyN8n } from '@/lib/events/notifyN8n';
import { createOpaqueToken, hashOpaqueToken } from '@/lib/feedback/testerInviteTokens';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { createServiceClient } from '@/lib/supabase/server';

export const TESTER_FEEDBACK_INVITE_WEBHOOK = '/webhook/tester-feedback-invite';
export const LEPEFY_PLATFORM_SIGNATURE = 'Propulsé par Lepefy';
export const LEPEFY_PLATFORM_TAGLINE = 'Solutions numériques sur mesure pour faire grandir votre activité';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function invitationCopy(tenantName: string, logoUrl: string | null, googlePlayUrl: string, feedbackUrl: string) {
  const safeTenant = escapeHtml(tenantName);
  const safePlay = escapeHtml(googlePlayUrl);
  const safeFeedback = escapeHtml(feedbackUrl);
  const safeLogo = logoUrl?.startsWith('https://') ? escapeHtml(logoUrl) : null;
  const subject = `Invitation à tester l’application ${tenantName}`;
  const text = [
    `Vous êtes invité(e) à tester l’application ${tenantName} 💜`, '',
    'Merci de participer à notre test privé.',
    'Votre retour nous aidera à améliorer l’application avant sa publication.', '',
    '1. Installer et tester l’application', googlePlayUrl,
    'Utilisez le même compte Google que celui communiqué pour participer au test.', '',
    '2. Partager votre avis', feedbackUrl,
    'Vous pouvez nous écrire à tout moment pendant la période de test.',
    'Même une remarque très courte nous est utile.', '',
    'Merci pour votre aide 💜', '', tenantName, '',
    LEPEFY_PLATFORM_SIGNATURE, LEPEFY_PLATFORM_TAGLINE,
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#25222b;line-height:1.6">
    ${safeLogo ? `<img src="${safeLogo}" alt="${safeTenant}" style="display:block;max-width:120px;max-height:72px;margin-bottom:24px">` : ''}
    <h1 style="font-size:24px">Vous êtes invité(e) à tester l’application ${safeTenant} 💜</h1>
    <p>Merci de participer à notre test privé.<br>Votre retour nous aidera à améliorer l’application avant sa publication.</p>
    <h2 style="font-size:18px">1. Installer et tester l’application</h2>
    <p><a href="${safePlay}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#6d28d9;color:#fff;text-decoration:none;font-weight:700">Ouvrir le test sur Google Play</a></p>
    <p>Utilisez le même compte Google que celui communiqué pour participer au test.</p>
    <h2 style="font-size:18px">2. Partager votre avis</h2>
    <p><a href="${safeFeedback}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#6d28d9;color:#fff;text-decoration:none;font-weight:700">Donner mon feedback</a></p>
    <p>Vous pouvez nous écrire à tout moment pendant la période de test.<br>Même une remarque très courte nous est utile.</p>
    <p>Merci pour votre aide 💜</p><p><strong>${safeTenant}</strong></p>
    <hr style="border:0;border-top:1px solid #eee;margin:28px 0 18px">
    <p style="font-size:12px;color:#6b7280"><strong>${LEPEFY_PLATFORM_SIGNATURE}</strong><br>${LEPEFY_PLATFORM_TAGLINE}</p>
  </div>`;
  return { subject, text, html };
}

export async function sendTesterFeedbackInvite(inviteId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data: invite } = await service.from('tester_feedback_invites')
    .select('id, tenant_id, campaign_id, email, activated_at, revoked_at')
    .eq('id', inviteId).maybeSingle();
  if (!invite || invite.revoked_at) return { ok: false, error: 'Invitation introuvable ou révoquée.' };
  if (invite.activated_at) return { ok: false, error: 'Cette invitation est déjà activée.' };

  const [{ data: campaign }, tenant] = await Promise.all([
    service.from('tester_feedback_campaigns').select('id, tenant_id, name, version_label, google_play_test_url').eq('id', invite.campaign_id).eq('tenant_id', invite.tenant_id).maybeSingle(),
    getTenantNotificationContext(invite.tenant_id),
  ]);
  if (!campaign?.google_play_test_url) return { ok: false, error: 'Ajoutez d’abord l’URL du test Google Play.' };
  if (!tenant?.storefrontUrl) return { ok: false, error: 'L’URL de la boutique du tenant est manquante.' };

  let storefront: URL;
  try {
    storefront = new URL(tenant.storefrontUrl);
    if (storefront.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    return { ok: false, error: 'L’URL de la boutique du tenant doit être une URL HTTPS valide.' };
  }

  const rawToken = createOpaqueToken();
  const tokenHash = hashOpaqueToken(rawToken);
  const feedbackUrl = new URL(`/feedback/invite/${rawToken}`, storefront).toString();
  const now = new Date().toISOString();
  const { error: rotateError } = await service.from('tester_feedback_invites').update({
    invite_token_hash: tokenHash,
    invite_token_created_at: now,
    invite_token_used_at: null,
    delivery_status: 'pending',
    sent_at: null,
    delivery_failed_at: null,
  }).eq('id', invite.id).eq('campaign_id', campaign.id).is('revoked_at', null).is('activated_at', null);
  if (rotateError) return { ok: false, error: 'Impossible de préparer l’invitation.' };

  const email = invitationCopy(tenant.tenantName, tenant.branding.logoUrl, campaign.google_play_test_url, feedbackUrl);
  const accepted = await notifyN8n(TESTER_FEEDBACK_INVITE_WEBHOOK, {
    type: 'tester_feedback_invite',
    tenant: { id: tenant.tenantId, name: tenant.tenantName, logo_url: tenant.branding.logoUrl },
    campaign: { id: campaign.id, name: campaign.name, version_label: campaign.version_label },
    recipient: { email: invite.email },
    links: { google_play_test_url: campaign.google_play_test_url, feedback_invite_url: feedbackUrl },
    email: { subject: email.subject, html: email.html, text: email.text, platform_signature: LEPEFY_PLATFORM_SIGNATURE, platform_tagline: LEPEFY_PLATFORM_TAGLINE },
    testMode: false,
  });

  const statusUpdate = accepted
    ? { delivery_status: 'sent', sent_at: now, delivery_failed_at: null }
    : { delivery_status: 'delivery_failed', sent_at: null, delivery_failed_at: now };
  const { error: statusError } = await service.from('tester_feedback_invites').update(statusUpdate)
    .eq('id', invite.id).eq('invite_token_hash', tokenHash).is('revoked_at', null);
  if (statusError) return { ok: false, error: 'Statut d’envoi impossible à enregistrer.' };
  return accepted ? { ok: true } : { ok: false, error: 'Le workflow e-mail n8n n’a pas accepté l’invitation.' };
}
