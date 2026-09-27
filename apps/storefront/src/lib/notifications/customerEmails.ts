import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import type { RenderedEmail } from '@/lib/notifications/sendEmail';

// Customer order emails, moved from the per-template n8n workflows (phase 2).
// Same copy and visual structure as the former n8n templates: optional test
// banner, branded header, info card, one primary CTA, support box, footer.
// Every dynamic value is escaped; links must be absolute http(s) URLs.

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function safeUrl(url: string | null | undefined) {
  return url && /^https?:\/\//.test(url) ? esc(url) : null;
}

function color(value: string | null | undefined, fallback: string) {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

export function formatMoney(context: TenantNotificationContext, amount: number | null | undefined) {
  return new Intl.NumberFormat(context.locale || 'fr-FR', { style: 'currency', currency: context.currency || 'EUR' })
    .format(Number(amount ?? 0));
}

interface Shell {
  testMode?: boolean;
  title: string;
  body: string;
}

function page(context: TenantNotificationContext, shell: Shell) {
  const primary = color(context.branding?.primaryColor, '#25222b');
  const secondary = color(context.branding?.secondaryColor, primary);
  const logo = safeUrl(context.branding?.logoUrl);
  const storefront = safeUrl(context.storefrontUrl);
  const business = context.business;
  const place = business?.legalAddress
    ? business.legalAddress
    : [business?.city, business?.country].filter(Boolean).join(', ');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:Arial,Helvetica,sans-serif;background:#f5f6f8;margin:0;padding:0;color:#252525}
.container{max-width:600px;margin:30px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07)}
.test-banner{background:#fff4cc;color:#6b5200;padding:10px 18px;text-align:center;font-size:12px;font-weight:700;border-bottom:1px solid #f2d76b}
.header{background:${primary};padding:30px 24px 32px;text-align:center}
.logo{display:block;width:auto;height:auto;max-width:170px;max-height:82px;margin:0 auto 20px}
.header h1{color:#ffffff;margin:0;font-size:24px;line-height:1.3}
.body{padding:32px 30px}
.body p{color:#333333;font-size:15px;line-height:1.65;margin:0 0 16px}
.info-box{background:#f8fafc;border-left:4px solid ${secondary};padding:20px;border-radius:6px;margin:24px 0}
.info-row{margin:0 0 14px;font-size:15px;line-height:1.55}
.info-row:last-child{margin-bottom:0}
.info-label{display:block;font-weight:700;margin-bottom:3px}
.mono{font-family:monospace;overflow-wrap:anywhere}
.warning-box{background:#fff8e6;border-left:4px solid #f0b429;padding:16px 18px;border-radius:6px;margin:20px 0;font-size:14px;line-height:1.6}
.notice-box{background:#f8fafc;padding:16px 18px;border-radius:6px;margin:20px 0;font-size:14px;line-height:1.6;color:#555555}
.cta-wrap{text-align:center;margin:30px 0 18px}
.cta{display:inline-block;background:${primary};color:#ffffff !important;text-decoration:none;padding:15px 24px;border-radius:8px;font-weight:700;font-size:15px}
.secondary-wrap{text-align:center;margin:-6px 0 18px}
.secondary-link{color:${primary} !important;font-weight:600;font-size:14px}
.note{font-size:13px !important;color:#666666 !important;text-align:center;margin-top:4px !important}
.support-box{background:#f8fafc;border-radius:8px;padding:18px;margin:28px 0 22px}
.support-box p{margin:0 0 12px}
.support-link{display:inline-block;margin-right:12px;margin-bottom:8px;color:${primary} !important;font-weight:700;text-decoration:none}
.footer{background:#f0f2f4;padding:24px 22px;text-align:center;font-size:12px;color:#777777;line-height:1.7}
.footer strong{color:#555555}
.footer a{color:${primary};text-decoration:none;font-weight:600}
@media only screen and (max-width:620px){.container{margin:0;border-radius:0}.body{padding:26px 20px}.header{padding:26px 20px 28px}.logo{max-width:155px;max-height:76px}}
</style>
</head>
<body>
<div class="container">
${shell.testMode ? '<div class="test-banner">🧪 EMAIL DE TEST — aucune commande réelle</div>' : ''}
<div class="header">
${logo ? `<img src="${logo}" alt="${esc(context.tenantName)}" class="logo">` : ''}
<h1>${esc(shell.title)}</h1>
</div>
<div class="body">
${shell.body}
</div>
<div class="footer">
<strong>${esc(context.tenantName)}</strong>
${place ? `<br>📍 ${esc(place)}` : ''}
${storefront ? `<br><a href="${storefront}">🛍️ Visiter notre boutique</a>` : ''}
</div>
</div>
</body>
</html>`;
}

function greeting(fullName: string | null | undefined) {
  return `<p>Bonjour <strong>${esc(fullName || 'cher client')}</strong>,</p>`;
}

function infoBox(rows: Array<[string, string | null | undefined, { raw?: boolean; mono?: boolean }?]>) {
  const visible = rows.filter(([, value]) => value != null && value !== '');
  return `<div class="info-box">${visible.map(([label, value, opts]) =>
    `<div class="info-row"><span class="info-label">${esc(label)}</span>${opts?.mono ? `<span class="mono">${esc(value)}</span>` : opts?.raw ? value : esc(value)}</div>`).join('')}</div>`;
}

function cta(url: string | null | undefined, label: string) {
  const href = safeUrl(url);
  return href ? `<div class="cta-wrap"><a class="cta" href="${href}">${esc(label)}</a></div>` : '';
}

function supportBox(context: TenantNotificationContext, heading: string) {
  const { supportEmail, whatsappNumber } = context.emailBranding ?? { supportEmail: null, whatsappNumber: null };
  if (!supportEmail && !whatsappNumber) return '';
  const phone = whatsappNumber ? String(whatsappNumber).replace(/\D/g, '') : '';
  return `<div class="support-box"><p><strong>${esc(heading)}</strong><br>Notre équipe reste à votre disposition.</p>${
    supportEmail ? `<a class="support-link" href="mailto:${esc(supportEmail)}">✉️ Nous contacter par email</a>` : ''}${
    phone ? `<a class="support-link" href="https://wa.me/${phone}">💬 Nous contacter sur WhatsApp</a>` : ''}</div>`;
}

function signature(context: TenantNotificationContext, line: string) {
  return `<p>${line}</p><p><em>L'équipe ${esc(context.tenantName)}</em></p>`;
}

function subject(testMode: boolean | undefined, text: string) {
  return `${testMode ? '[TEST] ' : ''}${text}`;
}

interface OrderBase {
  orderNumber: string;
  fullName: string | null;
  orderTrackingLink: string | null;
  testMode?: boolean;
}

export interface ShippingAddressLike {
  line1?: string | null; line2?: string | null; postal_code?: string | null; city?: string | null; country?: string | null;
}

export function orderConfirmedEmail(context: TenantNotificationContext, input: OrderBase & {
  fulfillmentType: string | null; total: number; shippingTotal: number | null; shippingAddress: ShippingAddressLike | null;
}): RenderedEmail {
  const delivery = input.fulfillmentType === 'delivery';
  const address = delivery && input.shippingAddress
    ? [input.shippingAddress.line1, input.shippingAddress.line2,
      [input.shippingAddress.postal_code, input.shippingAddress.city].filter(Boolean).join(' '), input.shippingAddress.country]
      .filter(Boolean).map(esc).join('<br>')
    : null;
  return {
    subject: subject(input.testMode, `✅ Votre commande ${input.orderNumber} chez ${context.tenantName} est confirmée !`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      title: '🛒 Commande confirmée !',
      body: `${greeting(input.fullName)}
<p>Merci pour votre commande chez <strong>${esc(context.tenantName)}</strong>. Votre paiement a bien été reçu et votre commande est maintenant en préparation. 🌍</p>
${infoBox([
    ['📦 Commande', input.orderNumber],
    ['💰 Total', formatMoney(context, input.total)],
    delivery ? ['🚚 Frais de livraison', formatMoney(context, input.shippingTotal)] : ['🏪 Mode de remise', 'Click & Collect'],
    ['📍 Adresse de livraison', address, { raw: true }],
  ])}
<p>${delivery
    ? '🚚 Nous vous préviendrons dès que votre commande sera expédiée. Vous recevrez alors les informations nécessaires pour suivre votre colis.'
    : '🏪 Nous vous préviendrons dès que votre commande sera prête à être retirée.'}</p>
${cta(input.orderTrackingLink, '👀 Voir ma commande')}
${supportBox(context, '💬 Une question concernant votre commande ?')}
${signature(context, `🙏 Merci de faire confiance à <strong>${esc(context.tenantName)}</strong>.`)}`,
    }),
  };
}

export function orderShippedEmail(context: TenantNotificationContext, input: OrderBase & {
  trackingCode: string | null; trackingCarrier: string | null;
}): RenderedEmail {
  return {
    subject: subject(input.testMode, `🚚 Votre commande ${input.orderNumber} est en route !`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      title: '🚚 Votre commande est en route !',
      body: `${greeting(input.fullName)}
<p>Votre commande chez <strong>${esc(context.tenantName)}</strong> a été expédiée et est maintenant en route vers vous.</p>
${infoBox([
    ['📦 Commande', input.orderNumber],
    ['🚛 Transporteur', input.trackingCarrier],
    ['🔎 Numéro de suivi', input.trackingCode, { mono: true }],
  ])}
${cta(input.orderTrackingLink, '🚚 Suivre ma commande')}
<p class="note">Les informations de suivi peuvent prendre un peu de temps avant d’être mises à jour après l’expédition.</p>
${supportBox(context, '💬 Une question concernant votre livraison ?')}
${signature(context, 'Merci pour votre confiance.')}`,
    }),
  };
}

export function orderReadyForPickupEmail(context: TenantNotificationContext, input: OrderBase): RenderedEmail {
  const pickup = context.pickup ?? { address: null, mapsUrl: null, hours: null };
  const maps = safeUrl(pickup.mapsUrl);
  const tracking = safeUrl(input.orderTrackingLink);
  return {
    subject: subject(input.testMode, `🏪 Votre commande ${input.orderNumber} est prête à être retirée !`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      title: '🏪 Votre commande est prête !',
      body: `${greeting(input.fullName)}
<p>Bonne nouvelle : votre commande chez <strong>${esc(context.tenantName)}</strong> est prête à être retirée.</p>
<p>Vous pouvez venir la récupérer dès maintenant.</p>
${infoBox([
    ['📦 Commande', input.orderNumber],
    ['📍 Adresse de retrait', pickup.address],
    ['🕐 Horaires de retrait', pickup.hours ? esc(pickup.hours).replace(/\n/g, '<br>') : null, { raw: true }],
  ])}
${maps ? cta(pickup.mapsUrl, '📍 Itinéraire vers la boutique') : cta(input.orderTrackingLink, '👀 Voir ma commande')}
${maps && tracking ? `<div class="secondary-wrap"><a class="secondary-link" href="${tracking}">Voir les détails de ma commande</a></div>` : ''}
<p class="note">Gardez votre numéro de commande à portée de main lors du retrait.</p>
${supportBox(context, '💬 Une question avant votre retrait ?')}
${signature(context, `À très bientôt chez <strong>${esc(context.tenantName)}</strong>.`)}`,
    }),
  };
}

export function orderCompletedEmail(context: TenantNotificationContext, input: OrderBase & {
  completionType: 'picked_up' | 'delivered';
}): RenderedEmail {
  const pickedUp = input.completionType === 'picked_up';
  const tenant = `<strong>${esc(context.tenantName)}</strong>`;
  return {
    subject: subject(input.testMode, pickedUp
      ? `✅ Votre commande ${input.orderNumber} a bien été retirée`
      : `📦 Votre commande ${input.orderNumber} a été livrée`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      title: pickedUp ? '✅ Commande retirée' : '📦 Commande livrée',
      body: `${greeting(input.fullName)}
<p>${pickedUp
    ? `Votre commande chez ${tenant} a bien été retirée. Merci pour votre visite.`
    : `Votre commande chez ${tenant} est indiquée comme livrée.`}</p>
${infoBox([
    ['📦 Commande', input.orderNumber],
    [pickedUp ? '✅ Statut' : '📍 Statut de livraison', pickedUp ? 'Retrait effectué' : 'Livraison effectuée'],
  ])}
<p>${pickedUp
    ? 'Votre commande est maintenant terminée. Vous pouvez toujours consulter son détail depuis votre espace commande.'
    : '<strong>Vous n’avez pas reçu votre colis ou quelque chose ne va pas ?</strong><br>Contactez-nous afin que notre équipe puisse vous aider.'}</p>
${cta(input.orderTrackingLink, 'Voir ma commande')}
${supportBox(context, pickedUp ? '💬 Une question concernant votre commande ?' : '💬 Un problème avec votre livraison ?')}
${signature(context, pickedUp ? `À bientôt chez ${tenant} !` : `Merci d’avoir choisi ${tenant}.`)}`,
    }),
  };
}

export function orderCancelledEmail(context: TenantNotificationContext, input: OrderBase): RenderedEmail {
  return {
    subject: subject(input.testMode, `❌ Votre commande ${input.orderNumber} a été annulée`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      title: '❌ Commande annulée',
      body: `${greeting(input.fullName)}
<p>Nous vous informons que votre commande chez <strong>${esc(context.tenantName)}</strong> a été annulée.</p>
${infoBox([['📦 Commande', input.orderNumber], ['Statut', 'Annulée']])}
<div class="notice-box">Si un paiement a déjà été effectué, les éventuelles informations concernant son traitement vous seront communiquées séparément selon la situation de votre commande.</div>
${cta(input.orderTrackingLink, 'Voir ma commande')}
${supportBox(context, '💬 Une question concernant cette annulation ?')}
${signature(context, 'Merci de votre compréhension.')}`,
    }),
  };
}

export function paymentReminderEmail(context: TenantNotificationContext, input: {
  paymentReference: string; fullName: string | null; paymentMethodLabel: string; amount: number;
  providerHandoffStarted: boolean; resumeLink: string; testMode?: boolean;
}): RenderedEmail {
  const method = esc(input.paymentMethodLabel);
  return {
    subject: subject(input.testMode, `💳 Votre paiement ${input.paymentReference} est toujours à finaliser`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      title: '💳 Votre achat est toujours à finaliser',
      body: `${greeting(input.fullName)}
<p>Nous n’avons pas encore pu confirmer la finalisation de votre achat chez <strong>${esc(context.tenantName)}</strong>.</p>
${infoBox([
    ['Référence', input.paymentReference],
    ['💳 Moyen de paiement', input.paymentMethodLabel],
    ['Montant', formatMoney(context, input.amount)],
  ])}
<div class="warning-box">${input.providerHandoffStarted
    ? `<strong>⚠️ Vous avez peut-être déjà effectué ce paiement.</strong><br>Si vous avez déjà payé avec ${method}, <strong>ne payez pas une seconde fois</strong>. Aucune action supplémentaire n’est nécessaire de votre côté : notre équipe doit simplement vérifier sa réception.`
    : '<strong>Votre paiement n’est pas encore finalisé.</strong><br>Si vous souhaitez poursuivre votre achat, vous pouvez reprendre votre checkout en toute sécurité à partir du bouton ci-dessous.'}</div>
<p>En reprenant votre achat, vous pourrez conserver <strong>${method}</strong> ou choisir un autre moyen de paiement disponible.</p>
${cta(input.resumeLink, 'Reprendre mon achat')}
<p class="note">Si vous avez déjà effectué le paiement, ne cliquez pas pour payer à nouveau.</p>
${supportBox(context, '💬 Une question concernant votre paiement ?')}
${signature(context, 'Merci pour votre confiance.')}`,
    }),
  };
}
