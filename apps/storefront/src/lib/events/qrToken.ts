import crypto from 'crypto';

// Même mécanisme HMAC que lib/tracking/generateTrackingToken.ts (TRACKING_SECRET
// partagé), mais le token de redemption événement est un bearer token opaque
// stocké tel quel dans event_reservations.qr_token (contrainte unique) plutôt
// qu'une valeur re-dérivée à la volée : le QR encode directement ce token, et
// la RPC redeem_event_reservation() fait un lookup exact — pas de recalcul
// HMAC nécessaire côté lecture, contrairement au lien /orders/[id]?token=.
export function generateEventQrToken(reservationId: string, eventId: string): string {
  return crypto
    .createHmac('sha256', process.env.TRACKING_SECRET!)
    .update(`event_reservation:${reservationId}:${eventId}`)
    .digest('hex');
}
