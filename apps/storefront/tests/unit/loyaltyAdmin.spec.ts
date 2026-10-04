import { expect, test } from '@playwright/test';
import {
  changedLoyaltySections,
  formatTierPercent,
  loyaltyFormIssues,
  percentInputToDecimal,
  pointsForAmount,
  referralAccessReasonLabel,
  referralTierIssues,
  type LoyaltyForm,
} from '../../src/lib/loyalty/loyaltyAdmin';

const form: LoyaltyForm = {
  loyalty_enabled: true,
  purchase_points_rate: 1,
  referral_max_depth: 2,
  referral_availability_mode: 'ALL_CUSTOMERS',
  referral_unlock_spending_threshold: 0,
  referral_fraud_max_conversions: 10,
  referral_fraud_period_days: 30,
  referral_fraud_action: 'FLAG_FOR_REVIEW',
};

test('percent input is typed in % and stored as a decimal', () => {
  expect(percentInputToDecimal('10')).toBe(0.1);
  expect(percentInputToDecimal('2,5')).toBe(0.025);
  expect(percentInputToDecimal('0')).toBe(0);
  for (const raw of ['', 'abc', '-1', '101']) expect(percentInputToDecimal(raw), raw).toBeNull();
  expect(formatTierPercent(0.1)).toBe('10 %');
  expect(formatTierPercent(0.025)).toBe('2,5 %');
});

test('tier issues: missing level, beyond depth, high total', () => {
  const tiers = [{ level: 1, pct: 0.1, is_active: true }, { level: 2, pct: 0.03, is_active: true }];
  expect(referralTierIssues(2, tiers)).toEqual([]);
  expect(referralTierIssues(3, tiers).map((i) => i.kind)).toEqual(['missing_level']);
  expect(referralTierIssues(1, tiers).map((i) => i.kind)).toEqual(['beyond_depth']);
  expect(referralTierIssues(1, [{ level: 1, pct: 0.6, is_active: true }]).map((i) => i.kind)).toEqual(['high_total']);
  // Historical versions are ignored.
  expect(referralTierIssues(1, [{ level: 1, pct: 0.1, is_active: true }, { level: 3, pct: 0.9, is_active: false }])).toEqual([]);
});

test('only changed sections are saved', () => {
  expect(changedLoyaltySections(form, form)).toEqual({ loyalty: false, referral: false, labels: [] });
  expect(changedLoyaltySections(form, { ...form, purchase_points_rate: 2 })).toEqual({ loyalty: true, referral: false, labels: ['Points par €'] });
  const both = changedLoyaltySections(form, { ...form, loyalty_enabled: false, referral_max_depth: 3 });
  expect(both.loyalty && both.referral).toBe(true);
  expect(both.labels).toEqual(['Activation du programme', 'Profondeur']);
});

test('form issues', () => {
  expect(loyaltyFormIssues(form)).toEqual([]);
  expect(loyaltyFormIssues({ ...form, purchase_points_rate: 0 })).toHaveLength(1);
  expect(loyaltyFormIssues({ ...form, referral_max_depth: 6 })).toHaveLength(1);
  expect(loyaltyFormIssues({ ...form, referral_availability_mode: 'SPENDING_THRESHOLD', referral_unlock_spending_threshold: 0 })).toHaveLength(1);
  expect(loyaltyFormIssues({ ...form, referral_fraud_period_days: 0, referral_fraud_max_conversions: 1.5 })).toHaveLength(2);
});

test('example and labels', () => {
  expect(pointsForAmount(50, 1)).toBe(50);
  expect(pointsForAmount(50, 1.5)).toBe(75);
  expect(pointsForAmount(50, 0)).toBe(0);
  expect(referralAccessReasonLabel('ADMIN_GRANTED')).toBe('Accordé manuellement');
  expect(referralAccessReasonLabel('THRESHOLD_MET')).toBe('Seuil de dépense atteint');
  expect(referralAccessReasonLabel(null)).toBe('Accordé');
});
