/**
 * Pure helpers of Admin → Fidélité & parrainage (/admin/loyalty), shared by
 * the page sections, the tiers API and unit tests. No server imports.
 */

export const MAX_REFERRAL_DEPTH = 5;
/** Above this total of commissions (all levels), the configuration is flagged. */
export const HIGH_TOTAL_COMMISSION_PCT = 50;

/** "10" or "10,5" (percent typed by the admin) → 0.1 / 0.105; null when invalid. */
export function percentInputToDecimal(raw: string): number | null {
  const value = Number(raw.replace(',', '.').trim());
  if (raw.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100) / 10000;
}

/** 0.105 → "10,5 %" */
export function formatTierPercent(decimal: number): string {
  const pct = Math.round(decimal * 10000) / 100;
  return `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

export interface TierLike {
  level: number;
  pct: number;
  is_active: boolean;
}

export interface TierIssue {
  kind: 'missing_level' | 'beyond_depth' | 'high_total';
  message: string;
}

/** Inconsistencies between the chain depth and the active tiers. */
export function referralTierIssues(depth: number, tiers: TierLike[]): TierIssue[] {
  const active = tiers.filter((tier) => tier.is_active);
  const levels = new Set(active.map((tier) => tier.level));
  const issues: TierIssue[] = [];
  const missing = Array.from({ length: Math.max(0, depth) }, (_, i) => i + 1).filter((level) => !levels.has(level));
  if (missing.length > 0) {
    issues.push({
      kind: 'missing_level',
      message: `Aucun pourcentage actif pour le niveau ${missing.join(', ')} : ${missing.length > 1 ? 'ces niveaux ne rapportent' : 'ce niveau ne rapporte'} rien au parrain.`,
    });
  }
  const beyond = [...levels].filter((level) => level > depth).sort((a, b) => a - b);
  if (beyond.length > 0) {
    issues.push({
      kind: 'beyond_depth',
      message: `Pourcentage actif au niveau ${beyond.join(', ')}, au-delà de la profondeur (${depth}) : il n’est jamais appliqué.`,
    });
  }
  const total = active.filter((tier) => tier.level <= depth).reduce((sum, tier) => sum + tier.pct, 0) * 100;
  if (total > HIGH_TOTAL_COMMISSION_PCT) {
    issues.push({
      kind: 'high_total',
      message: `Les commissions cumulées atteignent ${Math.round(total)} % d’un achat : vérifiez les pourcentages.`,
    });
  }
  return issues;
}

export interface LoyaltySectionForm {
  loyalty_enabled: boolean;
  purchase_points_rate: number;
}

export interface ReferralSectionForm {
  referral_max_depth: number;
  referral_availability_mode: string;
  referral_unlock_spending_threshold: number;
  referral_fraud_max_conversions: number;
  referral_fraud_period_days: number;
  referral_fraud_action: string;
}

export type LoyaltyForm = LoyaltySectionForm & ReferralSectionForm;

const LOYALTY_KEYS: Array<keyof LoyaltySectionForm> = ['loyalty_enabled', 'purchase_points_rate'];
const REFERRAL_KEYS: Array<keyof ReferralSectionForm> = [
  'referral_max_depth', 'referral_availability_mode', 'referral_unlock_spending_threshold',
  'referral_fraud_max_conversions', 'referral_fraud_period_days', 'referral_fraud_action',
];

const FIELD_LABELS: Record<keyof LoyaltyForm, string> = {
  loyalty_enabled: 'Activation du programme',
  purchase_points_rate: 'Points par €',
  referral_max_depth: 'Profondeur',
  referral_availability_mode: 'Éligibilité',
  referral_unlock_spending_threshold: 'Seuil de déblocage',
  referral_fraud_max_conversions: 'Conversions max',
  referral_fraud_period_days: 'Fenêtre anti-fraude',
  referral_fraud_action: 'Action anti-fraude',
};

/** Which sections changed (each one has its own API) and the changed field labels. */
export function changedLoyaltySections(baseline: LoyaltyForm, form: LoyaltyForm) {
  const loyalty = LOYALTY_KEYS.filter((key) => baseline[key] !== form[key]);
  const referral = REFERRAL_KEYS.filter((key) => baseline[key] !== form[key]);
  return {
    loyalty: loyalty.length > 0,
    referral: referral.length > 0,
    labels: [...loyalty, ...referral].map((key) => FIELD_LABELS[key]),
  };
}

/** Client-side guard (the APIs validate again). */
export function loyaltyFormIssues(form: LoyaltyForm): string[] {
  const issues: string[] = [];
  if (!(form.purchase_points_rate > 0)) issues.push('Le nombre de points par € doit être supérieur à 0.');
  if (!Number.isInteger(form.referral_max_depth) || form.referral_max_depth < 1 || form.referral_max_depth > MAX_REFERRAL_DEPTH) {
    issues.push(`La profondeur doit être comprise entre 1 et ${MAX_REFERRAL_DEPTH}.`);
  }
  if (form.referral_availability_mode === 'SPENDING_THRESHOLD' && !(form.referral_unlock_spending_threshold > 0)) {
    issues.push('Le seuil de déblocage doit être supérieur à 0 €.');
  }
  if (!Number.isInteger(form.referral_fraud_max_conversions) || form.referral_fraud_max_conversions < 1) {
    issues.push('Le nombre maximal de conversions doit être un entier positif.');
  }
  if (!Number.isInteger(form.referral_fraud_period_days) || form.referral_fraud_period_days < 1) {
    issues.push('La fenêtre anti-fraude doit être d’au moins 1 jour.');
  }
  return issues;
}

/** Points earned for an amount, same rounding as the earning RPCs. */
export function pointsForAmount(amount: number, rate: number): number {
  return rate > 0 ? Math.round(amount * rate) : 0;
}

const ACCESS_REASONS: Record<string, string> = {
  DEFAULT_ENABLED: 'Ouvert à tous',
  THRESHOLD_MET: 'Seuil de dépense atteint',
  ADMIN_GRANTED: 'Accordé manuellement',
};

export function referralAccessReasonLabel(reason: string | null | undefined): string {
  return reason ? ACCESS_REASONS[reason] ?? reason : 'Accordé';
}
