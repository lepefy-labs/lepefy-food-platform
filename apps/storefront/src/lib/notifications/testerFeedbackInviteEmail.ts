export const TESTER_FEEDBACK_INVITE_WEBHOOK = '/webhook/tester-feedback-invite';
export const LEPEFY_PLATFORM_SIGNATURE = 'Propulsé par Lepefy';
export const LEPEFY_PLATFORM_TAGLINE = 'Solutions numériques sur mesure pour faire grandir votre activité';
export const LEPEFY_PLATFORM_URL = 'https://www.lepefy.com';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function buildTesterFeedbackInviteEmail(
  tenantName: string,
  logoUrl: string | null,
  googlePlayUrl: string,
  feedbackUrl: string,
) {
  const safeTenant = escapeHtml(tenantName);
  const safePlay = escapeHtml(googlePlayUrl);
  const safeFeedback = escapeHtml(feedbackUrl);
  const safeLogo = logoUrl?.startsWith('https://') ? escapeHtml(logoUrl) : null;
  const safeLepefyUrl = escapeHtml(LEPEFY_PLATFORM_URL);
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
    LEPEFY_PLATFORM_SIGNATURE,
    LEPEFY_PLATFORM_TAGLINE,
    `Découvrir Lepefy : ${LEPEFY_PLATFORM_URL}`,
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
    <hr style="border:0;border-top:1px solid #eee;margin:28px 0 20px">
    <div style="font-family:Arial,sans-serif;color:#6b7280;line-height:1.55">
      <p style="margin:0;font-size:16px;font-weight:700">
        Propulsé par <a href="${safeLepefyUrl}" style="color:#6D5AF6;text-decoration:none">Lepefy</a>
      </p>
      <p style="margin:5px 0 0;font-size:14px">${LEPEFY_PLATFORM_TAGLINE}</p>
      <p style="margin:12px 0 0">
        <a href="${safeLepefyUrl}" style="font-size:14px;font-weight:700;color:#6D5AF6;text-decoration:none">Découvrir Lepefy →</a>
      </p>
    </div>
  </div>`;
  return { subject, text, html };
}
