import { SHOP_TIME_ZONE, shopLocalToIso } from '@/lib/time/shopTime';

/** Calendar day (YYYY-MM-DD) in Paris: prospecting days follow the platform owner, not UTC. */
export function parisDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** ISO instant of midnight in Paris for the current day. */
export function parisDayStartIso(now: Date = new Date()): string {
  return shopLocalToIso(`${parisDay(now)}T00:00`) ?? now.toISOString();
}
