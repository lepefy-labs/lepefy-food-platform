import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import type { RenderedEmail } from '@/lib/notifications/sendEmail';
import { cardPaymentReference } from '@/lib/card/cardPaymentOutcome';

export { cardPaymentReference };

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
  /** Footer link; defaults to the storefront ("Visiter notre boutique"). */
  footerLink?: { url: string | null | undefined; label: string };
  /** Banner text in test mode. */
  testLabel?: string;
  /** Storefront footer credit, shown when the tenant keeps tenants.show_powered_by. */
  poweredBy?: boolean;
}

function page(context: TenantNotificationContext, shell: Shell) {
  const primary = color(context.branding?.primaryColor, '#25222b');
  const secondary = color(context.branding?.secondaryColor, primary);
  const logo = safeUrl(context.branding?.logoUrl);
  const footerLink = safeUrl(shell.footerLink ? shell.footerLink.url : context.storefrontUrl);
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
.customer-box{background:#f8fafc;border-radius:8px;padding:18px;margin:20px 0}
.customer-box h2{font-size:15px;margin:0 0 10px}
.customer-box p{margin:0 0 6px !important}
.items-box{border:1px solid #eef0f3;border-radius:8px;padding:16px 18px;margin:20px 0}
.items-title{font-weight:700;margin-bottom:10px}
.item{padding:8px 0;border-top:1px solid #f0f2f4;font-size:14px;line-height:1.5}
.item:first-of-type{border-top:none}
.muted{color:#777777}
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
${shell.testMode ? `<div class="test-banner">${esc(shell.testLabel ?? '🧪 EMAIL DE TEST — aucune commande réelle')}</div>` : ''}
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
${footerLink ? `<br><a href="${footerLink}">${esc(shell.footerLink?.label ?? '🛍️ Visiter notre boutique')}</a>` : ''}
${shell.poweredBy ? '<br><span style="color:#999999;">Propulsé par <a href="https://www.lepefy.com" style="color:#777777;font-weight:600;">Lepefy Labs</a></span>' : ''}
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

/** Provider estimate as shown on the customer order page; null when absent or unparsable. */
export function formatEstimatedDeliveryDate(value: string | null | undefined) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Rome' }).format(date);
}

/** `YYYY-MM-DD` (date input) → midnight UTC ISO, the shape the Packlink adapter persists; otherwise null. */
export function estimatedDeliveryFromDateInput(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const iso = `${value}T00:00:00.000Z`;
  return new Date(iso).toISOString() === iso ? iso : null;
}

export function orderShippedEmail(context: TenantNotificationContext, input: OrderBase & {
  trackingCode: string | null; trackingCarrier: string | null;
  /** Persisted orders.shipping_estimated_delivery_at — never fetched from the provider here. */
  shippingEstimatedDeliveryAt?: string | null;
}): RenderedEmail {
  const estimatedDelivery = formatEstimatedDeliveryDate(input.shippingEstimatedDeliveryAt);
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
    ['📅 Livraison estimée', estimatedDelivery],
  ])}
${cta(input.orderTrackingLink, '🚚 Suivre ma commande')}
<p class="note">${estimatedDelivery ? 'La date de livraison est une estimation du transporteur et peut évoluer. ' : ''}Les informations de suivi peuvent prendre un peu de temps avant d’être mises à jour après l’expédition.</p>
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

// ─── Batch B ────────────────────────────────────────────────────────────────

function dateTime(context: TenantNotificationContext, value: string | null | undefined, style: 'long' | 'medium' | 'full' = 'long') {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(context.locale || 'fr-FR', { dateStyle: style, timeStyle: 'short', timeZone: 'Europe/Rome' }).format(date);
}

function itemsBox(context: TenantNotificationContext, title: string, items: Array<{ quantity: number; name: string; unitPrice: number }>) {
  if (!items.length) return '';
  return `<div class="items-box"><div class="items-title">${esc(title)}</div>${items.map(item =>
    `<div class="item"><strong>${esc(item.quantity)} × ${esc(item.name)}</strong><br><span class="muted">${esc(formatMoney(context, item.unitPrice * item.quantity))}</span></div>`).join('')}</div>`;
}

function customerBox(context: TenantNotificationContext, customer: { fullName: string | null; email: string | null; phone: string | null }) {
  const primary = color(context.branding?.primaryColor, '#25222b');
  const phone = customer.phone ? String(customer.phone).replace(/[^\d+]/g, '') : '';
  return `<div class="customer-box"><h2>👤 Coordonnées du client</h2>${
    customer.fullName ? `<p><strong>${esc(customer.fullName)}</strong></p>` : ''}${
    customer.email ? `<p><a href="mailto:${esc(customer.email)}" style="color:${primary};">${esc(customer.email)}</a></p>` : ''}${
    phone ? `<p><a href="tel:${esc(phone)}" style="color:${primary};">${esc(customer.phone)}</a></p>` : ''}</div>`;
}

export function eventReservationConfirmedEmail(context: TenantNotificationContext, input: {
  customerName: string | null; eventTitle: string | null; eventDateStart: string | null; eventLocation: string | null;
  amountPaid: number; items: Array<{ quantity: number; label: string | null; unitPrice: number }>;
  ticketUrl: string | null; eventsUrl: string | null; testMode?: boolean;
}): RenderedEmail {
  const title = input.eventTitle ?? 'votre événement';
  return {
    subject: subject(input.testMode, `✅ Votre réservation pour ${title} est confirmée !`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      testLabel: '🧪 EMAIL DE TEST — aucune réservation réelle',
      title: '🎉 Réservation confirmée !',
      footerLink: { url: input.eventsUrl, label: 'Accéder aux événements' },
      body: `<p>Bonjour <strong>${esc(input.customerName || 'cher client')}</strong>,</p>
<p>Votre réservation pour <strong>${esc(title)}</strong> est confirmée.</p>
<p>Nous avons hâte de vous accueillir !</p>
${infoBox([
    ['📅 Date et heure', dateTime(context, input.eventDateStart)],
    ['📍 Lieu', input.eventLocation],
    ['💰 Total payé', formatMoney(context, input.amountPaid)],
  ])}
${itemsBox(context, 'Détail de votre réservation', input.items.map(item => ({ quantity: item.quantity, name: item.label || 'Billet', unitPrice: item.unitPrice })))}
${cta(input.ticketUrl, 'Voir mon billet et QR code →')}
<div class="notice-box"><strong>🎟️ Votre billet est important.</strong><br><br>Présentez le QR code disponible sur votre billet lors de votre arrivée. Il pourra être demandé pour valider votre réservation et accéder à l’événement.</div>
<p class="note">Conservez cet email ou ouvrez votre billet depuis votre téléphone avant votre arrivée.</p>
${supportBox(context, '💬 Une question concernant votre réservation ?')}
${signature(context, 'Merci et à très bientôt !')}`,
    }),
  };
}

export function externalPaymentAwaitingVerificationEmail(context: TenantNotificationContext, input: {
  paymentReference: string; paymentMethodLabel: string; amount: number; fulfillmentType: string | null;
  customer: { fullName: string | null; email: string | null; phone: string | null };
  items: Array<{ name: string; price: number; quantity: number }>; adminPaymentLink: string | null; testMode?: boolean;
}): RenderedEmail {
  const method = esc(input.paymentMethodLabel);
  return {
    subject: subject(input.testMode, `💳 Paiement externe à vérifier · ${input.paymentReference} · ${formatMoney(context, input.amount)}`),
    replyTo: input.customer.email,
    html: page(context, {
      testMode: input.testMode,
      testLabel: '🧪 EMAIL DE TEST — aucun paiement réel',
      title: '💳 Paiement externe à vérifier',
      body: `<p>Un client a choisi <strong>${method}</strong> pour finaliser son achat.</p>
<p>Vérifiez la réception du paiement avant de confirmer la commande.</p>
${infoBox([
    ['Référence', input.paymentReference],
    ['💳 Moyen de paiement', input.paymentMethodLabel],
    ['Montant à vérifier', formatMoney(context, input.amount)],
    ['Mode de remise', input.fulfillmentType === 'pickup' ? 'Click & Collect' : 'Livraison'],
  ])}
${customerBox(context, input.customer)}
${itemsBox(context, 'Détail de l’achat', input.items.map(item => ({ quantity: Number(item.quantity), name: item.name, unitPrice: Number(item.price) })))}
<div class="warning-box"><strong>⚠️ Ne confirmez pas le paiement sans avoir vérifié sa réception.</strong><br>Le fait que le client ait ouvert ou utilisé le lien de paiement ne confirme pas que les fonds ont été reçus. Vérifiez directement le compte du prestataire <strong>${method}</strong> avant de valider la réception.</div>
${cta(input.adminPaymentLink, 'Vérifier le paiement')}
<p class="note">Tant que le paiement n’est pas confirmé, aucun stock n’est réservé et aucune commande définitive n’est créée.</p>`,
    }),
  };
}

export function eventExternalPaymentAwaitingVerificationEmail(context: TenantNotificationContext, input: {
  event: { title: string; dateStart: string | null; location: string | null };
  paymentReference: string; paymentMethodLabel: string; amount: number; quantityTotal: number;
  customer: { fullName: string | null; email: string | null; phone: string | null };
  items: Array<{ name: string; price: number; quantity: number }>; adminPaymentLink: string | null;
  eventsUrl: string | null; testMode?: boolean;
}): RenderedEmail {
  const method = esc(input.paymentMethodLabel);
  return {
    subject: subject(input.testMode, `🎟️ Réservation à vérifier · ${input.event.title} · ${input.paymentReference} · ${formatMoney(context, input.amount)}`),
    replyTo: input.customer.email,
    html: page(context, {
      testMode: input.testMode,
      testLabel: '🧪 EMAIL DE TEST — aucun paiement réel',
      title: '🎟️ Réservation à vérifier',
      footerLink: { url: input.eventsUrl, label: 'Accéder aux événements' },
      body: `<p>Une nouvelle demande de réservation a été créée pour <strong>${esc(input.event.title)}</strong>.</p>
<p>Le client a choisi <strong>${method}</strong> pour effectuer son paiement.</p>
<p>Vérifiez la réception du paiement avant de confirmer la réservation.</p>
${infoBox([
    ['Événement', input.event.title],
    ['📅 Date', dateTime(context, input.event.dateStart, 'medium')],
    ['📍 Lieu', input.event.location],
    ['Référence', input.paymentReference],
    ['💳 Moyen de paiement', input.paymentMethodLabel],
    ['Montant à vérifier', formatMoney(context, input.amount)],
    ['Places demandées', String(input.quantityTotal)],
  ])}
${customerBox(context, input.customer)}
${itemsBox(context, 'Détail de la réservation', input.items.map(item => ({ quantity: Number(item.quantity), name: item.name, unitPrice: Number(item.price) })))}
<div class="warning-box"><strong>⚠️ Ne confirmez pas la réservation sans avoir vérifié la réception du paiement.</strong><br><br>Le fait que le client ait ouvert ou utilisé le lien de paiement ne signifie pas que les fonds ont été reçus.<br><br>Vérifiez directement le compte du prestataire <strong>${method}</strong> avant de valider la réservation.</div>
${cta(input.adminPaymentLink, 'Vérifier et confirmer la réservation')}
<p class="note">Tant que le paiement n’est pas confirmé, aucune place n’est réservée et aucun billet n’est créé.</p>`,
    }),
  };
}

export function reviewInviteEmail(context: TenantNotificationContext, input: {
  kind: 'initial' | 'reminder'; orderNumber: string; reviewUrl: string; expiresAt: string; testMode?: boolean;
}): RenderedEmail {
  const reminder = input.kind === 'reminder';
  const tenant = `<strong>${esc(context.tenantName)}</strong>`;
  const expires = new Date(input.expiresAt);
  return {
    subject: subject(input.testMode, reminder
      ? `Un petit rappel : partagez votre expérience avec ${context.tenantName}`
      : `Votre avis compte pour ${context.tenantName}`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      title: reminder ? 'Votre avis nous intéresse toujours' : 'Comment s’est passée votre expérience ?',
      body: `<p>Bonjour,</p>
<p>${reminder
    ? `Vous avez récemment effectué une commande chez ${tenant}. Si vous avez quelques instants, vous pouvez encore partager votre expérience.`
    : `Merci pour votre commande chez ${tenant}. Nous aimerions connaître votre expérience.`}</p>
<p class="note">Votre avis est lié à une commande vérifiée et sera soumis à modération avant publication.</p>
${cta(input.reviewUrl, 'Donner mon avis')}
<p class="note">Commande vérifiée ${esc(input.orderNumber)}${Number.isNaN(expires.getTime()) ? '' : `<br>Ce lien personnel expire le ${esc(expires.toLocaleDateString('fr-FR', { timeZone: 'Europe/Rome' }))}.`}</p>`,
    }),
  };
}

export function cardQuickPaymentEmail(context: TenantNotificationContext, input: {
  amount: number; currency: string; customerName: string | null; customerEmail: string | null; paidAt: string; paymentIntentId: string;
}): RenderedEmail {
  const amount = new Intl.NumberFormat(context.locale || 'fr-FR', { style: 'currency', currency: (input.currency || 'EUR').toUpperCase() })
    .format(input.amount);
  return {
    subject: `Paiement carte reçu · ${amount} — ${context.tenantName}`,
    replyTo: input.customerEmail,
    html: page(context, {
      title: '💳 Paiement carte reçu',
      body: `<p>Un paiement par carte vient d’être reçu sur <strong>${esc(context.tenantName)}</strong>.</p>
${infoBox([
    ['Montant', amount],
    ['Client', input.customerName || 'Non renseigné'],
    ['Email', input.customerEmail || 'Non renseigné'],
    ['Date', dateTime(context, input.paidAt, 'medium')],
    ['Référence Stripe', input.paymentIntentId, { mono: true }],
  ])}
<p class="note">Notification automatique · Lepefy Food Platform</p>`,
    }),
  };
}

function channel(hex: string) {
  const c = parseInt(hex, 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** White or near-black text, whichever contrasts best with the brand color (WCAG). */
function readableOn(background: string) {
  let hex = background.replace('#', '');
  if (hex.length === 3 || hex.length === 4) hex = hex.slice(0, 3).split('').map(c => c + c).join('');
  hex = hex.slice(0, 6);
  const luminance = 0.2126 * channel(hex.slice(0, 2)) + 0.7152 * channel(hex.slice(2, 4)) + 0.0722 * channel(hex.slice(4, 6));
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#111111';
}

const DIVIDER = '<div style="border-top:1px solid #e5e7eb;margin:32px 0;font-size:0;line-height:0;">&nbsp;</div>';

function androidAppBlock(context: TenantNotificationContext) {
  const android = context.mobileApp?.android;
  if (!android) return '';
  const url = android.status === 'available' ? safeUrl(android.playStoreUrl) : null;
  // A released app without a public listing yet is announced, never linked.
  if (android.status === 'available' && !url) return '';
  const base = context.assetBaseUrl?.replace(/\/$/, '');
  const badge = safeUrl(base ? `${base}/badges/google-play-fr.png` : null);
  const tenant = esc(context.tenantName);
  return `${DIVIDER}
<div style="text-align:center;">
<p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#111827;">📱 ${url ? `${tenant} est disponible sur Android` : `${tenant} bientôt sur Android`}</p>
<p style="margin:0 0 18px;font-size:14px;color:#4b5563;">Retrouvez encore plus facilement votre boutique depuis votre téléphone.</p>
${url
    ? badge
      // Official Google Play badge (public/badges, downloaded from Google's badge page), unaltered, with the required attribution.
      ? `<a href="${url}" style="display:inline-block;text-decoration:none;"><img src="${badge}" width="180" height="70" alt="Disponible sur Google Play" style="display:block;width:180px;max-width:100%;height:auto;border:0;"></a>
<p style="margin:10px 0 0;font-size:11px;line-height:1.5;color:#9ca3af;">Google Play et le logo Google Play sont des marques de Google LLC.</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr><td style="border:2px solid #111827;border-radius:10px;"><a href="${url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#111827;text-decoration:none;">Disponible sur Google Play →</a></td></tr></table>`
    : '<span style="display:inline-block;padding:10px 18px;border-radius:999px;background:#f3f4f6;color:#4b5563;font-size:14px;font-weight:600;">Bientôt disponible sur Google Play</span>'}
</div>`;
}

/**
 * Confirmation sent to the customer after a /card payment (cardQuickPaymentEmail
 * is the tenant alert). Transactional first — status, amount, reference — then
 * one entry point to the tenant storefront and the Android app state. No
 * coupon, tracking parameter or marketing opt-in.
 */
export function cardQuickPaymentCustomerEmail(context: TenantNotificationContext, input: {
  quickPaymentId: string; amount: number; currency: string; customerName: string | null; paidAt: string; testMode?: boolean;
}): RenderedEmail {
  const amount = new Intl.NumberFormat(context.locale || 'fr-FR', { style: 'currency', currency: (input.currency || 'EUR').toUpperCase() })
    .format(input.amount);
  const tenant = `<strong>${esc(context.tenantName)}</strong>`;
  const name = input.customerName?.trim();
  const paid = new Date(input.paidAt);
  const locale = context.locale || 'fr-FR';
  const when = Number.isNaN(paid.getTime()) ? null
    : `${new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Europe/Rome' }).format(paid)} · ${
      new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'Europe/Rome' }).format(paid)}`;

  const commerce = context.commerce;
  const shopUrl = commerce?.storefrontReady === false ? null : safeUrl(context.storefrontUrl);
  const primary = color(context.branding?.primaryColor, '#25222b');
  const options = !commerce ? '' : commerce.clickCollectEnabled
    ? ' et choisissez la livraison ou le retrait en boutique' : ' et faites-vous livrer';
  const benefits = ['Commande en ligne', 'Paiement sécurisé', ...(commerce ? ['Livraison'] : []), ...(commerce?.clickCollectEnabled ? ['Retrait en boutique'] : [])];

  const row = (label: string, value: string, first = false) =>
    `<tr><td style="padding:13px 16px;font-size:14px;color:#6b7280;${first ? '' : 'border-top:1px solid #e5e7eb;'}">${esc(label)}</td><td align="right" style="padding:13px 16px;font-size:15px;color:#111827;text-align:right;${first ? '' : 'border-top:1px solid #e5e7eb;'}">${value}</td></tr>`;

  const shopBlock = shopUrl ? `${DIVIDER}
<div style="text-align:center;">
<h2 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827;">Votre prochain panier peut venir directement à vous.</h2>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4b5563;">Retrouvez tous les produits de ${tenant} sur notre boutique en ligne. Commandez tranquillement depuis votre téléphone${options}.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr><td align="center" bgcolor="${primary}" style="background:${primary};border-radius:10px;"><a href="${shopUrl}" style="display:block;padding:17px 20px;font-size:16px;font-weight:700;letter-spacing:0.5px;line-height:20px;color:${readableOn(primary)};text-decoration:none;border-radius:10px;">COMMANDER EN LIGNE →</a></td></tr></table>
<p style="margin:0;font-size:13px;color:#6b7280;">${benefits.map(esc).join(' · ')}</p>
</div>` : '';

  return {
    subject: subject(input.testMode, `✅ Votre paiement de ${amount} chez ${context.tenantName} est confirmé`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      testLabel: '🧪 EMAIL DE TEST — aucun paiement réel',
      title: '✓ Paiement confirmé',
      footerLink: shopUrl ? undefined : { url: null, label: '' },
      poweredBy: commerce?.showPoweredBy ?? false,
      body: `<div style="text-align:center;margin:0 0 26px;">
<div style="font-size:36px;font-weight:700;line-height:1.2;color:#111827;">${esc(amount)}</div>
<div style="margin-top:6px;font-size:14px;color:#6b7280;">payé chez ${tenant}</div>
</div>
<p>${name ? `Bonjour <strong>${esc(name)}</strong>,` : 'Bonjour,'}</p>
<p>Votre paiement de <strong>${esc(amount)}</strong> a bien été reçu.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;margin:22px 0;">
${row('Montant', `<strong>${esc(amount)}</strong>`, true)}
${when ? row('Date', esc(when)) : ''}
${row('Statut', '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#d1fae5;color:#065f46;font-size:13px;font-weight:700;">✓ Payé</span>')}
${row('Référence', `<span style="font-family:monospace;font-weight:700;">${esc(cardPaymentReference(input.quickPaymentId))}</span>`)}
</table>
<p>Votre paiement a été enregistré avec succès.<br>Merci pour votre confiance et votre visite chez ${tenant}.</p>
${shopBlock}
${androidAppBlock(context)}
${supportBox(context, '💬 Une question concernant votre paiement ?')}`,
    }),
  };
}

/** Sender identity of platform emails (admin invitation, tester invitation). */
export const PLATFORM_EMAIL_CONTEXT = {
  tenantId: '', tenantSlug: 'lepefy', tenantName: 'Lepefy Food Platform', storefrontUrl: '', locale: 'fr-FR', currency: 'EUR',
  branding: { logoUrl: null, primaryColor: '#111827', secondaryColor: '#6b7280', accentColor: '#f3f4f6' },
  emailBranding: { fromName: 'Lepefy Food Platform', fromEmail: 'noreply@lepefy.com', supportEmail: null, whatsappNumber: null },
  business: { city: null, country: '', legalAddress: null },
  pickup: { address: null, mapsUrl: null, hours: null },
} satisfies TenantNotificationContext;

/** Platform email (not tenant-branded): the sender and header are Lepefy. */
export function adminInvitedEmail(input: {
  tenantName: string; role: string; invitedByEmail: string; loginUrl: string;
}): RenderedEmail {
  return {
    subject: `Accès administrateur activé — ${input.tenantName}`,
    html: page(PLATFORM_EMAIL_CONTEXT, {
      title: 'Accès administrateur activé',
      footerLink: { url: null, label: '' },
      body: `<p>Bonjour,</p>
<p>Un accès administrateur vient de vous être attribué sur la plateforme <strong>${esc(input.tenantName)}</strong>, avec le rôle <strong>${esc(input.role)}</strong>.</p>
<p>Ajouté par : ${esc(input.invitedByEmail)}</p>
<p>Aucun mot de passe n’est nécessaire : connectez-vous avec cette adresse email, un code de vérification à 6 chiffres vous sera envoyé automatiquement.</p>
${cta(input.loginUrl, 'Se connecter')}
<p class="note">Si vous ne vous attendiez pas à recevoir cet email, vous pouvez l’ignorer en toute sécurité.</p>`,
    }),
  };
}

/** Final booking reports sent when event reservations close (attachments are added by the caller). */
export function eventBookingClosedReportsEmail(context: TenantNotificationContext, input: {
  eventTitle: string; eventDateStart: string | null; reservations: number; people: number; testMode?: boolean;
}): RenderedEmail {
  return {
    subject: subject(input.testMode, `Rapports définitifs · ${input.eventTitle}`),
    replyTo: context.emailBranding?.supportEmail,
    html: page(context, {
      testMode: input.testMode,
      testLabel: '🧪 EMAIL DE TEST — aucune réservation réelle',
      title: '📋 Rapports définitifs de l’événement',
      body: `<p>Les réservations de l’événement <strong>${esc(input.eventTitle)}</strong> sont désormais clôturées.</p>
<p>Les documents opérationnels définitifs sont joints à cet e-mail.</p>
${infoBox([
    ['Événement', input.eventTitle],
    ['Date', dateTime(context, input.eventDateStart, 'full')],
    ['Réservations valides', String(input.reservations)],
    ['Personnes', String(input.people)],
  ])}
<div class="items-box"><div class="items-title">Documents joints</div><div class="item">📊 Rapport détaillé des réservations</div><div class="item">🖨️ Liste imprimable</div><div class="item">🎟️ Codes de réservation A5</div></div>
<div class="notice-box"><strong>ℹ️ Ces documents correspondent à l’état des réservations au moment de la clôture.</strong><br><br>Les réservations manuelles ajoutées ultérieurement par l’administration ne sont pas incluses dans cet envoi automatique.</div>
<p class="note">Généré automatiquement par Lepefy.</p>`,
    }),
  };
}
