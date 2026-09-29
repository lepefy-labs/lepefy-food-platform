import { schedulerBearerAuthorized } from '@/lib/shipping/shippingSyncAuth';

/**
 * Dedicated bearer auth for n8n shipping campaign ticks. During the safe
 * migration, the existing service-role bearer remains valid for the GitHub
 * workflow_dispatch fallback. Never send the service-role key to n8n.
 * All credentials are server-only environment variables.
 */
export function shippingCampaignSchedulerAuthorized(
  authorization: string | null,
  schedulerToken: string | undefined = process.env.SHIPPING_CAMPAIGN_SCHEDULER_TOKEN,
  legacyServiceRole: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY,
): boolean {
  return schedulerBearerAuthorized(authorization, schedulerToken, legacyServiceRole);
}
