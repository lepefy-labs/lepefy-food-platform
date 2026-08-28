import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getNotificationRecipients } from '@/lib/notifications/getNotificationRecipients';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { getEventsBaseUrl } from '@/lib/events/ticketUrl';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { htmlToPdf } from '@/lib/labels/gotenberg';
import {
  buildReservationListHtml,
  buildReservationsCsv,
  buildReservationTableCardsHtml,
  loadEventReservationExportData,
} from '@/lib/events/adminReservationExports';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

function safeFilePart(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evenement';
}

async function setError(supabase: ReturnType<typeof createServiceClient>, eventId: string, token: string, message: string) {
  await supabase.from('events').update({
    booking_close_reports_status: 'error',
    booking_close_reports_claimed_at: null,
    booking_close_reports_last_error: message.slice(0, 500),
  }).eq('id', eventId).eq('booking_close_reports_dispatch_token', token);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { eventId?: unknown; dispatchToken?: unknown } | null;
  const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
  const dispatchToken = typeof body?.dispatchToken === 'string' ? body.dispatchToken : '';
  if (!eventId || !dispatchToken) return NextResponse.json({ error: 'eventId et dispatchToken requis.' }, { status: 400 });

  const supabase = createServiceClient();
  const { data: claim, error: claimError } = await supabase.rpc('claim_event_booking_close_reports', {
    p_event_id: eventId,
    p_dispatch_token: dispatchToken,
  });
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (claim === 'sent') return NextResponse.json({ ok: true, state: 'already_sent' });
  if (claim === 'busy') return NextResponse.json({ ok: true, state: 'already_processing' }, { status: 202 });
  if (claim === 'past_event') return NextResponse.json({ ok: true, state: 'past_event_skipped' });
  if (claim !== 'claimed') return NextResponse.json({ error: `Dispatch refusé: ${String(claim)}` }, { status: claim === 'too_early' ? 409 : 404 });

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, tenant_id, title, date_start, booking_close_reports_dispatch_token')
    .eq('id', eventId)
    .eq('booking_close_reports_dispatch_token', dispatchToken)
    .maybeSingle();
  if (eventError || !event) {
    await setError(supabase, eventId, dispatchToken, eventError?.message ?? 'event_missing_after_claim');
    return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
  }

  try {
    const recipients = await getNotificationRecipients(supabase, event.tenant_id, 'notify_event_booking_closed_reports');
    if (recipients.length === 0) {
      await setError(supabase, eventId, dispatchToken, 'no_notification_recipients');
      return NextResponse.json({ error: 'Aucun destinataire configuré pour les rapports de clôture.' }, { status: 422 });
    }

    const [{ data: tenant }, exportData, tenantContext] = await Promise.all([
      supabase.from('tenants').select('name, logo_url, currency').eq('id', event.tenant_id).maybeSingle(),
      loadEventReservationExportData(supabase, event.tenant_id, eventId),
      getTenantNotificationContext(event.tenant_id),
    ]);
    if (!tenant || !exportData || !tenantContext) throw new Error('tenant_or_export_context_missing');

    const origin = getEventsBaseUrl().replace(/\/$/, '');
    const csv = buildReservationsCsv(exportData, tenant.currency);
    const [listPdf, cardsPdf] = await Promise.all([
      htmlToPdf(buildReservationListHtml(exportData, tenant.name, tenant.logo_url)),
      htmlToPdf(buildReservationTableCardsHtml(exportData, tenant.name, tenant.logo_url, origin)),
    ]);
    const filePart = safeFilePart(event.title);
    const sentAt = new Date().toISOString();
    const validReservations = exportData.reservations.filter((reservation) => reservation.status === 'confirmed' && reservation.quantity_remaining > 0);
    const peopleTotal = validReservations.reduce((sum, reservation) => sum + reservation.quantity_total, 0);

    const accepted = await notifyN8n('/webhook/event-booking-closed-reports', {
      ...tenantContext,
      notificationType: 'event_booking_closed_reports',
      deliveryId: `event-booking-close-reports:${eventId}:${dispatchToken}`,
      recipients,
      event: { id: eventId, title: event.title, dateStart: event.date_start },
      summary: { reservations: validReservations.length, people: peopleTotal },
      generatedAt: sentAt,
      attachments: [
        { filename: `reservations-${filePart}.csv`, contentType: 'text/csv; charset=utf-8', contentBase64: Buffer.from(csv, 'utf8').toString('base64') },
        { filename: `liste-reservations-${filePart}.pdf`, contentType: 'application/pdf', contentBase64: listPdf.toString('base64') },
        { filename: `codes-reservations-a5-${filePart}.pdf`, contentType: 'application/pdf', contentBase64: cardsPdf.toString('base64') },
      ],
    });
    if (!accepted) throw new Error('n8n_report_email_not_accepted');

    const { error: sentStateError } = await supabase.from('events').update({
      booking_close_reports_status: 'sent',
      booking_close_reports_claimed_at: null,
      booking_close_reports_sent_at: sentAt,
      booking_close_reports_last_error: null,
    }).eq('id', eventId).eq('booking_close_reports_dispatch_token', dispatchToken);
    if (sentStateError) throw new Error(`sent_state_update_failed:${sentStateError.message}`);
    return NextResponse.json({ ok: true, state: 'sent', sentAt, recipients: recipients.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_report_error';
    console.error('[event closing reports] delivery failed:', error, '— event:', eventId);
    await setError(supabase, eventId, dispatchToken, message);
    return NextResponse.json({ error: 'Échec de la génération ou de l’envoi des rapports.' }, { status: 500 });
  }
}
