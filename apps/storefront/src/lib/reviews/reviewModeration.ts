export const REVIEW_REASON_CODES = ['spam','personal_data','abuse','threats','hate','illegal','irrelevant','duplicate','other'] as const;
export type ReviewReasonCode = typeof REVIEW_REASON_CODES[number];

const URL_RE = /(?:https?:\/\/|www\.)\S+/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?\d[\d .()-]{7,}\d)/;

export function normalizeReviewText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function deterministicReviewFlags(body: string | null, blacklistTerms: string[]): string[] {
  if (!body) return [];
  const normalized = normalizeReviewText(body);
  const flags = new Set<string>();
  if (URL_RE.test(body)) flags.add('contains_url');
  if (EMAIL_RE.test(body) || PHONE_RE.test(body)) flags.add('possible_personal_data');
  for (const rawTerm of blacklistTerms) {
    const term = normalizeReviewText(rawTerm);
    if (term && (` ${normalized} `).includes(` ${term} `)) flags.add(`blocked_term:${term}`);
  }
  if (/(.)\1{9,}/u.test(body)) flags.add('spam_pattern');
  return [...flags];
}

export function reviewerDisplayName(fullName: string | null, _email: string): string {
  const clean = fullName?.trim();
  if (!clean) return 'Client vérifié';
  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]![0]?.toUpperCase() ?? ''}.` : '';
  return `${first}${last}`.slice(0, 80) || 'Client vérifié';
}
