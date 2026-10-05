import { expect, test } from '@playwright/test';
import {
  appendNote,
  applySalesTransition,
  contactLinks,
  daysOverdue,
  endOfLocalDay,
  followUpState,
  NOTES_MAX,
  presetFollowUp,
  salesIssues,
  type SalesInput,
} from '../../src/lib/platform/prospects/salesPipeline';
import { salesSchema } from '../../src/lib/platform/prospects/validation';

const now = new Date('2026-10-05T10:00:00Z'); // 12:00 in Paris

const input: SalesInput = {
  status: 'qualified', last_contact_at: null, next_action_at: null, notes: null,
  lost_reason: null, do_not_contact: false, suppression_reason: null,
};

test('follow-up state uses the Paris day', () => {
  expect(followUpState(null, now)).toBe('none');
  expect(followUpState('2026-10-04T21:00:00Z', now)).toBe('overdue'); // 23:00 on 4 Oct in Paris
  expect(followUpState('2026-10-04T22:30:00Z', now)).toBe('today'); // 00:30 on 5 Oct in Paris
  expect(followUpState('2026-10-05T21:59:00Z', now)).toBe('today');
  expect(followUpState('2026-10-05T22:01:00Z', now)).toBe('upcoming');
  expect(daysOverdue('2026-10-02T08:00:00Z', now)).toBe(3);
  expect(daysOverdue('2026-10-05T08:00:00Z', now)).toBe(0);
});

test('end of local day is the next Paris midnight', () => {
  expect(endOfLocalDay(now)).toBe('2026-10-05T22:00:00.000Z');
  // Winter time (UTC+1).
  expect(endOfLocalDay(new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01T23:00:00.000Z');
});

test('presets land at 09:00 local', () => {
  const tomorrow = presetFollowUp(1, new Date(2026, 9, 5, 15, 30));
  expect([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([6, 9, 0]);
});

test('lost and opposition require a reason', () => {
  expect(salesIssues(input)).toEqual([]);
  expect(salesIssues({ ...input, status: 'lost' })).toHaveLength(1);
  expect(salesIssues({ ...input, status: 'lost', lost_reason: '  ' })).toHaveLength(1);
  expect(salesIssues({ ...input, status: 'lost', lost_reason: 'Déjà équipé' })).toEqual([]);
  expect(salesIssues({ ...input, do_not_contact: true })).toHaveLength(1);
  expect(salesIssues({ ...input, do_not_contact: true, suppression_reason: 'Demande du gérant' })).toEqual([]);
});

test('status transitions stamp the contact and close the next action', () => {
  const current = { status: 'qualified' as const, last_contact_at: null };
  const contacted = applySalesTransition(current, { ...input, status: 'contacted' }, now);
  expect(contacted.last_contact_at).toBe(now.toISOString());
  // A date typed by the user is kept.
  expect(applySalesTransition(current, { ...input, status: 'contacted', last_contact_at: '2026-10-01T08:00:00.000Z' }, now).last_contact_at)
    .toBe('2026-10-01T08:00:00.000Z');
  // Saving without a status change does not stamp.
  expect(applySalesTransition({ status: 'contacted', last_contact_at: null }, { ...input, status: 'contacted' }, now).last_contact_at).toBeNull();
  const won = applySalesTransition(current, { ...input, status: 'won', next_action_at: '2026-10-10T08:00:00.000Z' }, now);
  expect(won.next_action_at).toBeNull();
  expect(applySalesTransition(current, { ...input, status: 'qualified', lost_reason: 'old' }, now).lost_reason).toBeNull();
  expect(applySalesTransition(current, { ...input, suppression_reason: 'old' }, now).suppression_reason).toBeNull();
});

test('notes are dated, newest first, bounded', () => {
  const first = appendNote(null, '  Appel, rappeler lundi ', now);
  expect(first).toBe('[05/10/2026 12:00] Appel, rappeler lundi');
  const second = appendNote(first, 'Démo fixée', new Date('2026-10-06T08:15:00Z'));
  expect(second.startsWith('[06/10/2026 10:15] Démo fixée\n\n[05/10/2026 12:00]')).toBe(true);
  expect(appendNote('x'.repeat(NOTES_MAX), 'nouvelle', now).length).toBe(NOTES_MAX);
});

test('contact links are hidden after an opposition', () => {
  const base = {
    phone: '01 23 45 67 89', public_email: 'contact@epicerie.fr', whatsapp_url: 'https://wa.me/33123456789',
    instagram_url: 'https://instagram.com/epicerie', facebook_url: null, website_url: 'https://epicerie.fr', do_not_contact: false,
  };
  expect(contactLinks(base).map((l) => l.key)).toEqual(['phone', 'email', 'whatsapp', 'instagram', 'website']);
  expect(contactLinks(base)[0]?.href).toBe('tel:0123456789');
  expect(contactLinks({ ...base, do_not_contact: true })).toEqual([]);
  expect(contactLinks({ ...base, website_url: 'javascript:alert(1)', public_email: 'not-an-email' }).map((l) => l.key)).toEqual(['phone', 'whatsapp', 'instagram']);
});

test('sales schema accepts a bounded note', () => {
  const body = { ...input, website_url: null };
  expect(salesSchema.safeParse({ ...body, append_note: 'Appel' }).success).toBe(true);
  expect(salesSchema.safeParse({ ...body, append_note: '   ' }).success).toBe(false);
  expect(salesSchema.safeParse({ ...body, append_note: 'x'.repeat(2001) }).success).toBe(false);
});
