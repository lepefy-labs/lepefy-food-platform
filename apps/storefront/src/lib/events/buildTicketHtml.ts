import { formatDate, formatPrice } from '@/lib/utils/format';

// Structure HTML du billet PDF (Gotenberg) — repris du visual "ticket-stub"
// de EventConfirmationClient.tsx (perforation, QR, infos réservation), mais
// rendu hors du contexte CSS du site : les couleurs tenant doivent donc être
// des valeurs hex réelles (primary_color), jamais var(--color-primary) —
// même principe que buildPosterHtml.ts.
interface BuildTicketHtmlParams {
  tenant: {
    name: string;
    primary_color: string;
  };
  event: {
    title: string;
    date_start: string;
    location: string | null;
  };
  reservation: {
    id: string;
    customer_name: string;
    amount_paid: number;
    quantity_total: number;
  };
  qrUrl: string;
}

export function buildTicketHtml({ tenant, event, reservation, qrUrl }: BuildTicketHtmlParams): string {
  const reference = reservation.id.slice(0, 8).toUpperCase();

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  @page { size: 100mm 180mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .ticket { width: 100mm; display: flex; flex-direction: column; }
  .header { padding: 8mm 6mm 6mm; text-align: center; color: #fff; background: ${tenant.primary_color}; }
  .tenant-name { font-size: 9pt; font-weight: 600; opacity: .9; margin: 0 0 2mm; }
  .event-title { font-size: 14pt; font-weight: 700; margin: 0 0 2mm; }
  .event-meta { font-size: 9pt; margin: 0; opacity: .92; }
  .perforation { border-top: 1.5px dashed #ccc; margin: 0 6mm; }
  .body { padding: 8mm 6mm; text-align: center; }
  .qr { width: 55mm; height: 55mm; margin: 0 auto 5mm; }
  .customer-name { font-size: 12pt; font-weight: 700; color: #111; margin: 0 0 2mm; }
  .details { font-size: 9pt; color: #666; margin: 0 0 4mm; }
  .reference { font-size: 8pt; font-family: monospace; letter-spacing: .05em; color: #888; margin: 0; }
</style></head><body>
  <div class="ticket">
    <div class="header">
      <p class="tenant-name">${tenant.name}</p>
      <h1 class="event-title">${event.title}</h1>
      <p class="event-meta">${formatDate(event.date_start)}${event.location ? ` — ${event.location}` : ''}</p>
    </div>
    <div class="perforation"></div>
    <div class="body">
      <img class="qr" src="${qrUrl}" alt="QR code d'entrée" />
      <p class="customer-name">${reservation.customer_name}</p>
      <p class="details">${reservation.quantity_total} place${reservation.quantity_total > 1 ? 's' : ''} — ${formatPrice(reservation.amount_paid, 'EUR')}</p>
      <p class="reference">RÉF. #${reference}</p>
    </div>
  </div>
</body></html>`;
}
