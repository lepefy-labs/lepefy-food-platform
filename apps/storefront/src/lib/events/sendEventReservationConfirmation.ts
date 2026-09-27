import { getEventsBaseUrl } from '@/lib/events/ticketUrl';
import { sendTenantEmail } from '@/lib/notifications/sendEmail';
import { eventReservationConfirmedEmail } from '@/lib/notifications/customerEmails';

/**
 * Customer confirmation of an event reservation (first send and admin resend),
 * rendered in-app and delivered through send-email with the delivery ledger.
 */
export async function sendEventReservationConfirmation(input: {
  tenantId: string;
  idempotencyKey: string;
  customerName: string | null;
  customerEmail: string;
  amountPaid: number;
  eventTitle: string | null;
  eventDateStart: string | null;
  eventLocation: string | null;
  items: Array<{ quantity: number; label: string | null; unitPrice: number }>;
  ticketUrl: string | null;
}): Promise<boolean> {
  return sendTenantEmail({
    tenantId: input.tenantId,
    notificationType: 'event_reservation_confirmed',
    idempotencyKey: input.idempotencyKey,
    recipients: [input.customerEmail],
    render: (context) => eventReservationConfirmedEmail(context, {
      customerName: input.customerName,
      eventTitle: input.eventTitle,
      eventDateStart: input.eventDateStart,
      eventLocation: input.eventLocation,
      amountPaid: input.amountPaid,
      items: input.items,
      ticketUrl: input.ticketUrl,
      eventsUrl: getEventsBaseUrl(),
    }),
  });
}
