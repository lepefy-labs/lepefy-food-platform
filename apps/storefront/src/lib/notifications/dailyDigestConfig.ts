import { z } from 'zod';
import type { ModuleConfigDefinition } from '@/lib/tenantConfig/moduleConfig';
import type { DigestThresholds } from '@/lib/notifications/dailyOrderDigest';

/**
 * Single source of truth for the 08:00 digest configuration stored in
 * tenant_feature_settings (feature_key = 'daily_order_digest', migration 129).
 * Keys and ranges mirror public.is_valid_daily_digest_config().
 */
export const DAILY_DIGEST_FEATURE_KEY = 'daily_order_digest';

const IANA_ZONE = /^(UTC|[A-Za-z]+(?:[/_-][A-Za-z0-9+_-]+)+)$/;

/** Accepts only named IANA zones (no raw offsets) that the runtime can resolve. */
export function isValidIanaTimeZone(value: string): boolean {
  if (!IANA_ZONE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const hours = (min: number) => z.number().int().min(min).max(336);

export const dailyDigestConfigSchema = z.object({
  version: z.literal(1),
  timezone: z.string().trim().min(1).max(64).refine(isValidIanaTimeZone, 'Fuseau horaire IANA invalide'),
  include_empty: z.boolean(),
  prepare_hours: hours(1),
  pickup_hours: hours(1),
  payment_verification_hours: hours(1),
  tracking_stale_hours: hours(24),
});

export type DailyDigestConfig = z.infer<typeof dailyDigestConfigSchema>;

export const DAILY_DIGEST_DEFAULTS: DailyDigestConfig = {
  version: 1,
  timezone: 'Europe/Rome',
  include_empty: false,
  prepare_hours: 24,
  pickup_hours: 48,
  payment_verification_hours: 48,
  tracking_stale_hours: 72,
};

export const dailyDigestModule: ModuleConfigDefinition<DailyDigestConfig> = {
  featureKey: DAILY_DIGEST_FEATURE_KEY,
  schema: dailyDigestConfigSchema,
  defaults: DAILY_DIGEST_DEFAULTS,
};

/** Admin PATCH body: every field optional, unknown fields rejected. */
export const dailyDigestPatchSchema = z.object({
  enabled: z.boolean().optional(),
  config: dailyDigestConfigSchema.omit({ version: true }).partial().strict().optional(),
}).strict();

export function toDigestThresholds(config: DailyDigestConfig): DigestThresholds {
  return {
    prepareHours: config.prepare_hours,
    pickupHours: config.pickup_hours,
    paymentVerificationHours: config.payment_verification_hours,
    trackingStaleHours: config.tracking_stale_hours,
  };
}
