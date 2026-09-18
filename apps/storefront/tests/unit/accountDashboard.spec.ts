import { test, expect } from '@playwright/test';
import { accountReferralState, referralDescription } from '@/lib/account/dashboard';

test('Suspension overrides previously granted referral access', () => {
  expect(accountReferralState(true, true, true)).toBe('suspended');
  expect(referralDescription({ state: accountReferralState(true, true, true), mode: 'ALL_CUSTOMERS', threshold: null }))
    .not.toContain('Partagez');
});

test('Disabled loyalty never advertises an eligible referral programme', () => {
  expect(accountReferralState(false, true, false)).toBe('unavailable');
  expect(accountReferralState(false, true, true)).toBe('unavailable');
});

test('Missing access flags do not advertise an invitation link', () => {
  expect(accountReferralState(true, null, null)).toBe('locked');
  expect(accountReferralState(true, undefined, undefined)).toBe('locked');
  expect(accountReferralState(true, true, false)).toBe('eligible');
});
