import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getCustomers, applyCustomSegment } from '@/lib/admin/crm';
import { isE2ERequest } from '@/lib/e2e/isE2ERequest';
import type { CrmCustomerListItem, SegmentDefinition } from '@lepefy/types';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { deliverEmail } from '@/lib/notifications/sendEmail';
import { marketingCampaignEmail } from '@/lib/notifications/operationalEmails';

export function isEligibleMarketingRecipient(customer: Pick<CrmCustomerListItem, 'marketing_consent' | 'email'>): boolean {
  return customer.marketing_consent === true && !!customer.email?.trim();
}

async function loadAudience(tenantId: string, segmentId: string | null): Promise<CrmCustomerListItem[]> {
  const supabase = createServiceClient();
  if (segmentId) {
    const { data, error } = await supabase.from('customer_segments').select('kind,system_key,definition_json')
      .eq('tenant_id', tenantId).eq('id', segmentId).eq('active', true).single();
    if (error || !data) throw error ?? new Error('segment_not_found');
    if (data.kind === 'custom') return (await applyCustomSegment(tenantId, data.definition_json as SegmentDefinition, 10000)).customers;
    segmentId = data.system_key;
  }
  const audience: CrmCustomerListItem[] = [];
  let page = 1;
  while (audience.length < 10000) {
    const result = await getCustomers(tenantId, { segment: segmentId ?? 'all', page, pageSize: 100 });
    audience.push(...result.customers);
    if (audience.length >= result.count || result.customers.length === 0) break;
    page += 1;
  }
  return audience;
}

export function campaignRecipientIdempotencyKey(campaignId: string, customerId: string) {
  return createHash('sha256').update(`${campaignId}:${customerId}:v1`).digest('hex');
}

export function buildCampaignRecipientSnapshot(
  tenantId: string,
  campaignId: string,
  audience: CrmCustomerListItem[],
) {
  return audience.filter(isEligibleMarketingRecipient).map((customer) => ({
    tenant_id: tenantId,
    campaign_id: campaignId,
    customer_id: customer.id,
    channel_target: customer.email!,
    consent_granted: true,
    consent_recorded_at: customer.marketing_consent_at,
    status: 'pending',
    idempotency_key: campaignRecipientIdempotencyKey(campaignId, customer.id),
  }));
}

export async function dispatchMarketingCampaign(tenantId: string, campaignId: string) {
  const supabase = createServiceClient();
  const { data: campaign, error } = await supabase.from('marketing_campaigns').select('*')
    .eq('tenant_id', tenantId).eq('id', campaignId).single();
  if (error || !campaign) throw error ?? new Error('campaign_not_found');
  if (!['draft','scheduled','failed'].includes(campaign.status)) throw new Error('campaign_not_dispatchable');
  if (campaign.channel !== 'email') throw new Error('campaign_channel_not_configured');

  const audience = await loadAudience(tenantId, campaign.segment_id);
  const snapshot = buildCampaignRecipientSnapshot(tenantId, campaignId, audience);
  const eligible = snapshot;
  if (snapshot.length > 0) {
    const { error: snapshotError } = await supabase.from('marketing_campaign_recipients')
      .upsert(snapshot, { onConflict: 'campaign_id,customer_id', ignoreDuplicates: true });
    if (snapshotError) throw snapshotError;
  }

  await supabase.from('marketing_campaigns').update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', campaignId);

  const { data: recipients, error: recipientError } = await supabase.from('marketing_campaign_recipients').select('*')
    .eq('tenant_id', tenantId).eq('campaign_id', campaignId).eq('status', 'pending');
  if (recipientError) throw recipientError;

  let sent = 0;
  let failed = 0;
  const suppressDelivery = isE2ERequest() || process.env.NODE_ENV === 'test';
  const context = suppressDelivery ? null : await getTenantNotificationContext(tenantId);
  const email = context
    ? marketingCampaignEmail(context, { subject: campaign.subject, content: campaign.content, campaignName: campaign.name })
    : null;
  for (const recipient of recipients ?? []) {
    let ok = false;
    let failure: string | null = null;
    try {
      if (suppressDelivery) {
        failure = 'delivery_suppressed_in_test';
      } else if (!process.env.N8N_WEBHOOK_URL || !context || !email) {
        failure = 'provider_not_configured';
      } else {
        ok = await deliverEmail(context, {
          ...email,
          notificationType: 'marketing_campaign',
          idempotencyKey: `marketing-campaign:${recipient.idempotency_key}`,
          recipients: [recipient.channel_target],
        });
        if (!ok) failure = 'provider_rejected';
      }
    } catch (deliveryError) {
      failure = deliveryError instanceof Error ? deliveryError.message.slice(0, 500) : 'provider_error';
    }
    const now = new Date().toISOString();
    const status = ok ? 'sent' : suppressDelivery ? 'skipped' : 'failed';
    await supabase.from('marketing_campaign_recipients').update({ status, sent_at: ok ? now : null, last_error: failure })
      .eq('tenant_id', tenantId).eq('id', recipient.id);
    await supabase.from('marketing_campaign_events').insert({
      tenant_id: tenantId, campaign_id: campaignId, recipient_id: recipient.id,
      event_type: status, metadata: failure ? { reason: failure } : {}, occurred_at: now,
    });
    if (ok) sent += 1; else failed += 1;
  }
  const finalStatus = failed > 0 && sent === 0 ? 'failed' : 'completed';
  await supabase.from('marketing_campaigns').update({ status: finalStatus, completed_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', campaignId);
  return { audience: audience.length, eligible: eligible.length, sent, failed, excluded: audience.length - eligible.length, status: finalStatus };
}
