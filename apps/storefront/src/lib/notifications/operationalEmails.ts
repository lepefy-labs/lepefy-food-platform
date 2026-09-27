import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import type { RenderedEmail } from '@/lib/notifications/sendEmail';

// Emails delivered through the generic `send-email` n8n workflow. Every value
// coming from customers or admins is escaped; links must be absolute http(s).

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function safeUrl(url: string | null | undefined) {
  return url && /^https?:\/\//.test(url) ? escapeHtml(url) : null;
}

function money(context: TenantNotificationContext, amount: number | null | undefined) {
  if (amount == null) return '—';
  return new Intl.NumberFormat(context.locale || 'fr-FR', { style: 'currency', currency: context.currency || 'EUR' }).format(amount);
}

function dateLabel(context: TenantNotificationContext, value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const withTime = value.length > 10;
  return new Intl.DateTimeFormat(context.locale || 'fr-FR', {
    dateStyle: 'full', ...(withTime ? { timeStyle: 'short' } : {}), timeZone: 'Europe/Rome',
  }).format(date);
}

interface Layout {
  title: string;
  intro: string;
  rows?: Array<[string, string | null | undefined]>;
  callout?: { text: string; tone: 'alert' | 'ok' | 'info' };
  cta?: { label: string; url: string | null | undefined };
  closing?: string;
  footerNote?: string;
}

const CALLOUT = { alert: '#fef3f2', ok: '#ecfdf3', info: '#eff8ff' } as const;

function layout(context: TenantNotificationContext, content: Layout) {
  const tenant = escapeHtml(context.tenantName);
  const logo = safeUrl(context.branding?.logoUrl);
  const color = /^#[0-9a-f]{3,8}$/i.test(context.branding?.primaryColor ?? '') ? context.branding.primaryColor : '#25222b';
  const cta = content.cta ? safeUrl(content.cta.url) : null;
  const rows = (content.rows ?? []).filter(([, value]) => value != null && value !== '');
  const storefront = safeUrl(context.storefrontUrl);
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#25222b;line-height:1.6">
    ${logo ? `<img src="${logo}" alt="${tenant}" style="display:block;max-width:140px;max-height:72px;margin-bottom:20px">` : ''}
    <h1 style="font-size:22px;color:${color}">${escapeHtml(content.title)}</h1>
    <p>${content.intro}</p>
    ${rows.length ? `<table style="border-collapse:collapse;margin:16px 0">${rows.map(([label, value]) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#6b6475;vertical-align:top">${escapeHtml(label)}</td><td>${escapeHtml(String(value))}</td></tr>`).join('')}</table>` : ''}
    ${content.callout ? `<p style="padding:12px;border-radius:8px;background:${CALLOUT[content.callout.tone]}"><strong>${escapeHtml(content.callout.text)}</strong></p>` : ''}
    ${content.closing ? `<p>${content.closing}</p>` : ''}
    ${cta && content.cta ? `<p><a href="${cta}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${color};color:#fff;text-decoration:none">${escapeHtml(content.cta.label)}</a></p>` : ''}
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px">
    <p style="font-size:12px;color:#6b6475">${tenant}${storefront ? ` · <a href="${storefront}" style="color:#6b6475">${storefront}</a>` : ''}${content.footerNote ? `<br>${content.footerNote}` : ''}</p>
  </div>`;
}

function refundLine(refundSucceeded: boolean | null, manualRefundRequired: boolean) {
  if (manualRefundRequired) return 'Paiement hors Stripe : remboursement manuel à effectuer.';
  if (refundSucceeded === true) return 'Le client a été remboursé automatiquement via Stripe.';
  if (refundSucceeded === false) return 'Le remboursement Stripe automatique a ÉCHOUÉ : remboursement manuel requis.';
  return 'Statut du remboursement inconnu : vérifier dans Stripe.';
}

function adminUrl(context: TenantNotificationContext, path: string) {
  return context.storefrontUrl ? `${context.storefrontUrl.replace(/\/$/, '')}${path}` : null;
}

export function eventCapacityConflictEmail(context: TenantNotificationContext, input: {
  eventTitle: string | null; eventDateStart: string | null; customerName: string; customerEmail: string;
  refundSucceeded: boolean | null; manualRefundRequired: boolean;
}): RenderedEmail {
  return {
    subject: `[Action requise] Événement complet après paiement · ${input.eventTitle ?? 'événement'} · ${context.tenantName}`,
    html: layout(context, {
      title: 'Réservation refusée : événement complet',
      intro: 'Un client a payé une réservation, mais la capacité de l’événement était déjà atteinte au moment de la validation. Aucune réservation n’a été créée.',
      rows: [['Événement', input.eventTitle], ['Date', dateLabel(context, input.eventDateStart)],
        ['Client', `${input.customerName} · ${input.customerEmail}`]],
      callout: { text: refundLine(input.refundSucceeded, input.manualRefundRequired), tone: input.refundSucceeded === true && !input.manualRefundRequired ? 'ok' : 'alert' },
      closing: 'Contactez le client pour lui proposer une autre date ou confirmer le remboursement.',
      cta: { label: 'Ouvrir les événements →', url: adminUrl(context, '/admin/evenementiel/evenements') },
    }),
  };
}

export function rentalStockConflictEmail(context: TenantNotificationContext, input: {
  serviceTitle: string | null; customerName: string; customerEmail: string;
  refundSucceeded: boolean | null; manualRefundRequired: boolean;
}): RenderedEmail {
  return {
    subject: `[Action requise] Matériel indisponible après paiement · ${input.serviceTitle ?? 'location'} · ${context.tenantName}`,
    html: layout(context, {
      title: 'Réservation de matériel refusée : stock insuffisant',
      intro: 'Un client a payé une location, mais le matériel n’était plus disponible au moment de la validation. Aucune réservation n’a été créée.',
      rows: [['Service', input.serviceTitle], ['Client', `${input.customerName} · ${input.customerEmail}`]],
      callout: { text: refundLine(input.refundSucceeded, input.manualRefundRequired), tone: input.refundSucceeded === true && !input.manualRefundRequired ? 'ok' : 'alert' },
      closing: 'Contactez le client pour lui proposer une alternative ou confirmer le remboursement.',
      cta: { label: 'Ouvrir les réservations matériel →', url: adminUrl(context, '/admin/evenementiel/reservations-materiel') },
    }),
  };
}

export function serviceInquiryEmail(context: TenantNotificationContext, input: {
  serviceTitle: string; customerName: string; customerEmail: string; customerPhone: string | null;
  dateSouhaitee: string | null; nombreInvites: number | null; message: string | null;
}): RenderedEmail {
  return {
    subject: `Nouvelle demande de devis · ${input.serviceTitle} · ${context.tenantName}`,
    replyTo: input.customerEmail,
    html: layout(context, {
      title: 'Nouvelle demande de devis',
      intro: `<strong>${escapeHtml(input.customerName)}</strong> souhaite un devis pour <strong>${escapeHtml(input.serviceTitle)}</strong>. Répondre à cet email écrit directement au client.`,
      rows: [['Email', input.customerEmail], ['Téléphone', input.customerPhone],
        ['Date souhaitée', input.dateSouhaitee ? dateLabel(context, input.dateSouhaitee) : null],
        ['Invités', input.nombreInvites != null ? String(input.nombreInvites) : null], ['Message', input.message]],
      cta: { label: 'Voir les demandes de devis →', url: adminUrl(context, '/admin/evenementiel/devis') },
    }),
  };
}

interface RentalReservationInput {
  reservationId: string; serviceTitle: string | null; customerName: string; customerEmail: string;
  customerPhone: string | null; pickupDate: string; amountPaid: number;
  items: Array<{ name: string; quantity: number }>;
  fulfillmentType: string; deliveryFeeStatus: string;
}

function rentalRows(context: TenantNotificationContext, input: RentalReservationInput): Array<[string, string | null]> {
  return [
    ['Service', input.serviceTitle],
    ['Date', dateLabel(context, input.pickupDate)],
    ['Matériel', input.items.map(item => `${item.quantity} × ${item.name}`).join(', ') || null],
    ['Mode', input.fulfillmentType === 'delivery' ? 'Livraison' : 'Retrait'],
    ['Montant payé', money(context, input.amountPaid)],
  ];
}

export function rentalReservationCustomerEmail(context: TenantNotificationContext, input: RentalReservationInput): RenderedEmail {
  const deliveryNote = input.fulfillmentType === 'delivery' && input.deliveryFeeStatus === 'pending_quote'
    ? 'Les frais de livraison vous seront communiqués séparément par notre équipe.' : null;
  return {
    subject: `Votre réservation de matériel est confirmée · ${context.tenantName}`,
    replyTo: context.emailBranding.supportEmail,
    html: layout(context, {
      title: 'Réservation confirmée',
      intro: `Bonjour ${escapeHtml(input.customerName)}, merci pour votre réservation. Voici son récapitulatif.`,
      rows: [...rentalRows(context, input), ['Référence', input.reservationId.slice(0, 8).toUpperCase()]],
      callout: deliveryNote ? { text: deliveryNote, tone: 'info' } : undefined,
      closing: context.emailBranding.supportEmail
        ? `Une question ? Écrivez-nous à ${escapeHtml(context.emailBranding.supportEmail)} ou répondez à cet email.` : undefined,
    }),
  };
}

export function rentalReservationAdminEmail(context: TenantNotificationContext, input: RentalReservationInput): RenderedEmail {
  return {
    subject: `Nouvelle réservation de matériel · ${input.customerName} · ${context.tenantName}`,
    replyTo: input.customerEmail,
    html: layout(context, {
      title: 'Nouvelle réservation de matériel',
      intro: `Réservation payée par <strong>${escapeHtml(input.customerName)}</strong>.`,
      rows: [...rentalRows(context, input), ['Email', input.customerEmail], ['Téléphone', input.customerPhone]],
      callout: input.deliveryFeeStatus === 'pending_quote'
        ? { text: 'Livraison sans tarif de zone : les frais de livraison sont à chiffrer.', tone: 'alert' } : undefined,
      cta: { label: 'Ouvrir les réservations matériel →', url: adminUrl(context, '/admin/evenementiel/reservations-materiel') },
    }),
  };
}

export function rentalDeliveryQuotePendingEmail(context: TenantNotificationContext, input: {
  reservationId: string; customerName: string; customerEmail: string; customerPhone: string | null;
  address: { street?: string | null; houseNumber?: string | null; postalCode?: string | null; city?: string | null; country?: string | null };
}): RenderedEmail {
  const a = input.address;
  const address = [[a.street, a.houseNumber].filter(Boolean).join(' '), [a.postalCode, a.city].filter(Boolean).join(' '), a.country]
    .filter(Boolean).join(', ');
  return {
    subject: `[Action requise] Frais de livraison à chiffrer · ${input.customerName} · ${context.tenantName}`,
    replyTo: input.customerEmail,
    html: layout(context, {
      title: 'Frais de livraison à chiffrer',
      intro: 'Une réservation de matériel avec livraison a été payée pour une adresse sans tarif de zone. Chiffrez les frais et informez le client.',
      rows: [['Client', input.customerName], ['Email', input.customerEmail], ['Téléphone', input.customerPhone],
        ['Adresse', address || null], ['Référence', input.reservationId.slice(0, 8).toUpperCase()]],
      cta: { label: 'Ouvrir les réservations matériel →', url: adminUrl(context, '/admin/evenementiel/reservations-materiel') },
    }),
  };
}

/**
 * Plain-text campaign content rendered as escaped paragraphs. There is no
 * automatic unsubscribe link yet: the footer gives a manual opt-out through
 * the tenant support address (replies go there via replyTo).
 */
export function marketingCampaignEmail(context: TenantNotificationContext, input: {
  subject: string | null; content: string; campaignName: string;
}): RenderedEmail {
  const paragraphs = input.content.split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
    .map(block => escapeHtml(block).replace(/\n/g, '<br>')).join('</p><p>');
  const support = context.emailBranding.supportEmail;
  const optOut = support
    ? `Vous recevez cet email car vous avez accepté les actualités de ${escapeHtml(context.tenantName)}. Pour ne plus les recevoir, répondez à cet email ou écrivez à ${escapeHtml(support)}.`
    : `Vous recevez cet email car vous avez accepté les actualités de ${escapeHtml(context.tenantName)}. Pour ne plus les recevoir, contactez-nous depuis notre boutique.`;
  return {
    subject: input.subject?.trim() || input.campaignName,
    replyTo: support,
    html: layout(context, {
      title: input.subject?.trim() || input.campaignName,
      intro: paragraphs || '',
      cta: { label: 'Visiter la boutique →', url: context.storefrontUrl },
      footerNote: optOut,
    }),
  };
}
