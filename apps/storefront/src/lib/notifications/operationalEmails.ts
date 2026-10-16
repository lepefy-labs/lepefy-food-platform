import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import type { RenderedEmail } from '@/lib/notifications/sendEmail';
import { staffAlertUrl, staffEmailSubject, type StaffAlert } from '@/lib/notifications/staff/staffMessages';
import { PRIORITY_LABEL } from '@/lib/notifications/staff/orderSignals';

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
  const color = /^#[0-9a-f]{3,8}$/i.test(context.branding?.primaryColor ?? '') ? context.branding.primaryColor : '#29304a';
  const cta = content.cta ? safeUrl(content.cta.url) : null;
  const rows = (content.rows ?? []).filter(([, value]) => value != null && value !== '');
  const storefront = safeUrl(context.storefrontUrl);
  const toneColor = content.callout?.tone === 'alert' ? '#b42318' : content.callout?.tone === 'ok' ? '#067647' : '#175cd3';
  const rowsHtml = rows.map(([label, value]) => {
    const prominent = /^(Montant|Montant total|Articles|Places)$/i.test(label);
    return `<tr><td style="padding:10px 12px 10px 0;color:#566176;font-size:13px;border-bottom:1px solid #e9edf3;vertical-align:top">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e9edf3;color:#182338;font-size:${prominent ? '17' : '14'}px;font-weight:${prominent ? '700' : '600'};word-break:break-word">${escapeHtml(String(value))}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#182338">
  <div style="display:none;font-size:1px;color:#f3f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(content.title)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f5f9"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e4e8f0;border-radius:12px">
      <tr><td style="padding:22px 26px;background:#182338;border-radius:12px 12px 0 0;color:#ffffff">
        ${logo ? `<img src="${logo}" alt="${tenant}" style="display:block;max-width:120px;max-height:48px;margin-bottom:12px">` : ''}
        <div style="font-size:17px;font-weight:700;line-height:1.4">Lepefy · ${tenant}</div>
        <div style="font-size:12px;color:#d0d8e7;margin-top:4px">NOTIFICATION OPÉRATIONNELLE</div>
      </td></tr>
      <tr><td style="padding:28px 26px 14px">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#182338">${escapeHtml(content.title)}</h1>
        <div style="font-size:15px;line-height:1.65;color:#485367">${content.intro}</div>
        ${rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:22px 0 16px">${rowsHtml}</table>` : ''}
        ${content.callout ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:${CALLOUT[content.callout.tone]};border-left:4px solid ${toneColor};border-radius:8px"><tr><td style="padding:15px 16px"><div style="font-size:12px;font-weight:700;color:${toneColor};margin-bottom:6px">ACTION ${content.callout.tone === 'alert' ? 'URGENTE' : 'À EFFECTUER'}</div><div style="font-size:15px;line-height:1.6;color:#182338;font-weight:600">${escapeHtml(content.callout.text)}</div></td></tr></table>` : ''}
        ${content.closing ? `<div style="font-size:14px;color:#485367;line-height:1.6;margin:18px 0">${content.closing}</div>` : ''}
        ${cta && content.cta ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 16px"><tr><td bgcolor="${color}" style="border-radius:8px"><a href="${cta}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${escapeHtml(content.cta.label)}</a></td></tr></table>` : ''}
      </td></tr>
      <tr><td style="border-top:1px solid #e4e8f0;padding:18px 26px 24px;font-size:12px;line-height:1.7;color:#657086">
        ${tenant}${storefront ? ` · <a href="${storefront}" style="color:#43546b">${storefront}</a>` : ''}
        ${content.footerNote ? `<div style="margin-top:6px">${escapeHtml(content.footerNote)}</div>` : ''}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
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

/**
 * Internal staff alert (dispatcher, migration 158): the same StaffAlert as the
 * WhatsApp text, rendered with the operational layout. Values are escaped by
 * the layout; the admin link comes from the tenant's storefront URL.
 */
export function staffAlertEmail(context: TenantNotificationContext, alert: StaffAlert, test = false): RenderedEmail {
  const priority = PRIORITY_LABEL[alert.priority];
  const indicators = [...(priority ? [priority] : []), ...alert.indicators];
  const intro = [
    test ? '<strong>[TEST] Message de test — aucune action requise.</strong>' : '',
    indicators.map((line) => escapeHtml(line)).join('<br>'),
  ].filter(Boolean).join('<br><br>') || escapeHtml(alert.title);
  return {
    subject: staffEmailSubject(alert, context.tenantName, test),
    html: layout(context, {
      title: alert.title,
      intro,
      rows: alert.details,
      callout: alert.action ? { text: alert.action, tone: alert.priority === 'urgent' ? 'alert' : 'info' } : undefined,
      closing: alert.note ? escapeHtml(alert.note).replace(/\n/g, '<br>') : undefined,
      cta: alert.link ? { label: `${alert.link.label} →`, url: staffAlertUrl(context.storefrontUrl, alert.link.path) } : undefined,
      footerNote: 'Notification interne Lepefy · réglages : Paramètres → Communication → Notifications.',
    }),
  };
}
