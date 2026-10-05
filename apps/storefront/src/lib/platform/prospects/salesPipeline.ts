import type { Prospect, SalesStatus } from './types';

/**
 * Pure rules of the commercial follow-up (no I/O): follow-up state, required
 * reasons, side effects of a status change and dated notes. Used by the
 * detail PATCH route and the prospect screens.
 */

/** Commercial stages shown as the pipeline, in order. */
export const PIPELINE_STAGES = ['qualified', 'contacted', 'replied', 'demo', 'pilot', 'won'] as const satisfies readonly SalesStatus[];
/** A closed prospect has no next action. */
export const CLOSED_STATUSES: readonly SalesStatus[] = ['won', 'lost', 'ignored'];
/** Moving to one of these means a conversation happened: the contact date is stamped when absent. */
export const CONTACT_STATUSES: readonly SalesStatus[] = ['contacted', 'replied', 'demo', 'pilot'];

export const NOTES_MAX = 10_000;
export const NOTE_MAX = 2_000;
export const SALES_TIME_ZONE = 'Europe/Paris';

export type FollowUpState = 'none' | 'overdue' | 'today' | 'upcoming';

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: SALES_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (value: Date) => dayFormatter.format(value);

export function followUpState(nextActionAt: string | null | undefined, now: Date = new Date()): FollowUpState {
  if (!nextActionAt) return 'none';
  const due = new Date(nextActionAt);
  if (Number.isNaN(due.getTime())) return 'none';
  const dueDay = dayKey(due);
  const today = dayKey(now);
  if (dueDay < today) return 'overdue';
  if (dueDay === today) return 'today';
  return 'upcoming';
}

/** Whole days between the due day and today (local), for « en retard 3 j ». */
export function daysOverdue(nextActionAt: string, now: Date = new Date()): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.max(0, Math.round((toUtc(dayKey(now)) - toUtc(dayKey(new Date(nextActionAt)))) / 86_400_000));
}

/** End of today in the sales time zone, as an ISO instant: the `follow_up=due` cutoff. */
export function endOfLocalDay(now: Date = new Date()): string {
  const key = dayKey(now);
  // Walk forward minute-precision is overkill: the next local midnight is within 22–26 h.
  for (let hours = 1; hours <= 26; hours += 1) {
    const candidate = new Date(now.getTime() + hours * 3_600_000);
    if (dayKey(candidate) !== key) {
      // Narrow down to the minute the day changes.
      let low = candidate.getTime() - 3_600_000;
      let high = candidate.getTime();
      while (high - low > 60_000) {
        const mid = Math.floor((low + high) / 2);
        if (dayKey(new Date(mid)) === key) low = mid; else high = mid;
      }
      return new Date(high).toISOString();
    }
  }
  return new Date(now.getTime() + 86_400_000).toISOString();
}

/** Quick follow-up presets: tomorrow, +3 days, +1 week at 09:00 local browser time. */
export function presetFollowUp(days: number, now: Date = new Date()): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date;
}

export interface SalesInput {
  status: SalesStatus;
  last_contact_at: string | null;
  next_action_at: string | null;
  notes: string | null;
  lost_reason: string | null;
  do_not_contact: boolean;
  suppression_reason: string | null;
}

/** Blocking issues, in French, checked by the API and shown by the form. */
export function salesIssues(input: Pick<SalesInput, 'status' | 'lost_reason' | 'do_not_contact' | 'suppression_reason'>): string[] {
  const issues: string[] = [];
  if (input.status === 'lost' && !input.lost_reason?.trim()) issues.push('Indiquez le motif de perte.');
  if (input.do_not_contact && !input.suppression_reason?.trim()) {
    issues.push('Indiquez le motif de l’opposition (« Ne pas contacter »).');
  }
  return issues;
}

/** Prepends a dated entry; the newest note is on top, the total stays within NOTES_MAX. */
export function appendNote(existing: string | null, note: string, now: Date = new Date()): string {
  const stamp = new Intl.DateTimeFormat('fr-FR', {
    timeZone: SALES_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(now).replace(',', '');
  const entry = `[${stamp}] ${note.trim()}`;
  const combined = existing?.trim() ? `${entry}\n\n${existing.trim()}` : entry;
  return combined.length > NOTES_MAX ? combined.slice(0, NOTES_MAX) : combined;
}

/**
 * Side effects of saving the sales form: a contact status stamps the contact
 * date when the user left it empty, a closed status clears the next action,
 * reasons are kept only while the prospect is lost / opposed.
 */
export function applySalesTransition(current: Pick<Prospect, 'status' | 'last_contact_at'>, input: SalesInput, now: Date = new Date()): SalesInput {
  const next = { ...input };
  const statusChanged = input.status !== current.status;
  if (statusChanged && CONTACT_STATUSES.includes(input.status) && !input.last_contact_at) {
    next.last_contact_at = now.toISOString();
  }
  if (CLOSED_STATUSES.includes(input.status)) next.next_action_at = null;
  // Reasons only describe the current state; the dated notes keep the history.
  if (input.status !== 'lost') next.lost_reason = null;
  if (!input.do_not_contact) next.suppression_reason = null;
  return next;
}

/** Contact links shown in the header; none when the prospect objected. */
export function contactLinks(p: Pick<Prospect, 'phone' | 'public_email' | 'whatsapp_url' | 'instagram_url' | 'facebook_url' | 'website_url' | 'do_not_contact'>):
  Array<{ key: string; label: string; href: string }> {
  if (p.do_not_contact) return [];
  const links: Array<{ key: string; label: string; href: string }> = [];
  const phone = p.phone?.replace(/[^\d+]/g, '');
  if (phone && phone.length >= 6) links.push({ key: 'phone', label: 'Appeler', href: `tel:${phone}` });
  if (p.public_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.public_email)) links.push({ key: 'email', label: 'E-mail', href: `mailto:${p.public_email}` });
  for (const [key, label, href] of [
    ['whatsapp', 'WhatsApp', p.whatsapp_url],
    ['instagram', 'Instagram', p.instagram_url],
    ['facebook', 'Facebook', p.facebook_url],
    ['website', 'Site', p.website_url],
  ] as const) {
    if (href && /^https:\/\//i.test(href)) links.push({ key, label, href });
  }
  return links;
}
