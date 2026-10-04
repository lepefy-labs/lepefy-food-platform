/**
 * Pure helpers for the in-store loyalty scan (/admin/loyalty/scan), shared by
 * ScanClient, the scan API routes and unit tests. Points themselves are always
 * computed by process_manual_purchase_points_atomic (migration 131): the
 * preview here only mirrors `round(p_amount * purchase_points_rate)`.
 */

/** Above this amount the cashier must confirm twice (typo guard: 5000 vs 50,00). */
export const UNUSUAL_AMOUNT_EUR = 300;

/** An identical purchase (same customer, same amount) inside this window is treated as a probable double credit. */
export const DUPLICATE_WINDOW_SECONDS = 120;

/** Minimum query length for the forgotten-card search. */
export const SCAN_SEARCH_MIN_LENGTH = 3;
export const SCAN_SEARCH_LIMIT = 5;

/**
 * Parses a cashier-typed amount ("50", "50,5", "1 234,50", "12.30 €").
 * Returns the amount rounded to cents, or null when not a positive number.
 */
export function parseScanAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Math.round(Number(cleaned) * 100) / 100;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Same rounding as the RPC (half away from zero; amounts are positive). Integer-cent math avoids float drift. */
export function previewPurchasePoints(amount: number, rate: number): number {
  if (!(amount > 0) || !(rate > 0)) return 0;
  const cents = Math.round(amount * 100);
  return Math.round(Number(((cents * rate) / 100).toFixed(6)));
}

export function isUnusualAmount(amount: number): boolean {
  return amount > UNUSUAL_AMOUNT_EUR;
}

/** `alice@gmail.com` → `a***@gmail.com`; never returns the full local part. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** Last 4 digits of a loyalty card, for display ("…0388"). */
export function cardLastDigits(cardNumber: string | null | undefined): string | null {
  const digits = (cardNumber ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export interface RecentManualPurchase {
  amount: number | string;
  created_at: string;
}

/**
 * Returns the age in seconds of the most recent identical purchase inside the
 * duplicate window, or null when there is none.
 */
export function findRecentDuplicate(
  purchases: RecentManualPurchase[],
  amount: number,
  now: Date = new Date(),
): number | null {
  const cents = Math.round(amount * 100);
  let youngest: number | null = null;
  for (const purchase of purchases) {
    if (Math.round(Number(purchase.amount) * 100) !== cents) continue;
    const age = Math.max(0, Math.floor((now.getTime() - new Date(purchase.created_at).getTime()) / 1000));
    if (age > DUPLICATE_WINDOW_SECONDS) continue;
    if (youngest === null || age < youngest) youngest = age;
  }
  return youngest;
}

/** "il y a 40 s" / "il y a 2 min" */
export function formatSecondsAgo(seconds: number): string {
  return seconds < 60 ? `il y a ${seconds} s` : `il y a ${Math.floor(seconds / 60)} min`;
}

/** Sanitizes the forgotten-card query (same character class as the assisted-order search). */
export function sanitizeScanSearch(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._+\- ]/g, '').slice(0, 60);
}
