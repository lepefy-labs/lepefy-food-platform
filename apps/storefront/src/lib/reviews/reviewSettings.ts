import { getTenantFeatureSetting } from '@/lib/entitlements/tenantFeatureSettings';

export interface ReviewSettings {
  publicDisplay: boolean;
  requestDelayHours: number;
  reminderAfterDays: number;
  inviteExpiryDays: number;
  minPublicCount: number;
  blacklistTerms: string[];
  aiModerationEnabled: false;
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  publicDisplay: true,
  requestDelayHours: 24,
  reminderAfterDays: 7,
  inviteExpiryDays: 30,
  minPublicCount: 3,
  blacklistTerms: [],
  aiModerationEnabled: false,
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export async function getReviewSettings(tenantId: string): Promise<ReviewSettings> {
  const setting = await getTenantFeatureSetting(tenantId, 'reviews');
  const config = setting?.config ?? {};
  const terms = Array.isArray(config.blacklist_terms)
    ? config.blacklist_terms.filter((item): item is string => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, 100)
    : [];
  return {
    publicDisplay: config.public_display !== false,
    requestDelayHours: boundedNumber(config.request_delay_hours, 24, 0, 168),
    reminderAfterDays: boundedNumber(config.reminder_after_days, 7, 1, 30),
    inviteExpiryDays: boundedNumber(config.invite_expiry_days, 30, 7, 90),
    minPublicCount: boundedNumber(config.min_public_count, 3, 1, 50),
    blacklistTerms: [...new Set(terms)],
    aiModerationEnabled: false,
  };
}
