/**
 * Heure de la boutique pour les dates saisies par le commerçant (début / fin
 * de promotion, fin de nouveauté). Le schéma n'a pas de fuseau par tenant :
 * comme Gestion, documents et prospects, la boutique vit à l'heure de Paris.
 * Pur, sans dépendance : utilisable par l'admin, l'API et les tests.
 */
export const SHOP_TIME_ZONE = 'Europe/Paris';

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Décalage (ms) du fuseau à cet instant : heure locale − UTC. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

/**
 * « 2026-10-20T09:00 » (champ datetime-local, heure de la boutique) → ISO UTC.
 * Null pour une valeur vide ou mal formée. Une heure inexistante (passage à
 * l'heure d'été) est décalée vers l'heure valide suivante.
 */
export function shopLocalToIso(local: string | null | undefined, timeZone = SHOP_TIME_ZONE): string | null {
  const match = LOCAL_PATTERN.exec((local ?? '').trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  if (Number.isNaN(wall)) return null;
  let instant = wall - zoneOffsetMs(wall, timeZone);
  const corrected = zoneOffsetMs(instant, timeZone);
  if (wall - corrected !== instant) instant = wall - corrected;
  return new Date(instant).toISOString();
}

/** ISO → « 2026-10-20T09:00 » à l'heure de la boutique (valeur d'un champ datetime-local). */
export function isoToShopLocal(iso: string | null | undefined, timeZone = SHOP_TIME_ZONE): string {
  if (!iso) return '';
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** « ven. 31 oct. » (court) ou « vendredi 31 octobre à 23:59 » (long), heure de la boutique. */
export function formatShopDate(iso: string, style: 'short' | 'long' = 'short', timeZone = SHOP_TIME_ZONE): string {
  const date = new Date(iso);
  if (style === 'short') {
    return new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  }
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${day} à ${time}`;
}
