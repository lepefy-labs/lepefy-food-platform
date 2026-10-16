import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTIFICATION_TYPES } from '@/lib/notifications/notificationTypes';
import { countSubscribersByType } from '@/lib/notifications/notificationSubscriptions';
import { checkBrevoAccount, configuredEmailTransport, type BrevoAccountStatus, type EmailTransportName } from '@/lib/notifications/emailTransport';
import { getGreenApiInstanceState, greenApiErrorLabel, readGreenApiOutboundConfig, type GreenApiInstanceState } from '@/lib/notifications/providers/greenApiOutbound';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { STAFF_WHATSAPP_FLAG } from '@/lib/notifications/staff/staffWhatsapp';

/** Retries overdue by more than this mean the n8n retry scheduler is not calling Lepefy. */
export const OVERDUE_RETRY_MINUTES = 10;

export type HealthLevel = 'ok' | 'warning' | 'error';

export interface NotificationHealth {
  transport: EmailTransportName;
  config: Array<{ label: string; ok: boolean; detail: string }>;
  brevo: BrevoAccountStatus | null;
  ledger: {
    available: boolean;
    last24h: Record<string, number>;
    last7d: Record<string, number>;
    overdueRetries: number;
    stuckProcessing: number;
    lastAcceptedAt: string | null;
  };
  digest: {
    enabled: boolean | null;
    timezone: string | null;
    lastRun: { localDate: string; status: string; acceptedAt: string | null; errorCode: string | null } | null;
  };
  /** Deliverable subscribers per notification type (whole catalogue), per channel. */
  recipients: Array<{ type: string; label: string; count: number; whatsapp: number | null }>;
  /** Lepefy WhatsApp service (Green API, migration 158). */
  whatsapp: {
    flagEnabled: boolean;
    configured: boolean;
    configSource: 'dedicated' | 'shared' | null;
    configDetail: string | null;
    instance: { state: GreenApiInstanceState; ok: boolean; error?: string } | null;
    checkedAt: string;
    queued: number;
    retriesDue: number;
    unknown: number;
    last24h: Record<string, number>;
    recentErrors: Array<{ at: string; error: string; label: string | null }>;
  };
}

function countByStatus(rows: Array<{ status: string }>) {
  return rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
}

/** Single platform-owner view of the email pipeline; secrets are reported as present/absent only. */
export async function loadNotificationHealth(db: SupabaseClient, tenantId: string, now = new Date()): Promise<NotificationHealth> {
  const transport = configuredEmailTransport();
  const config = [
    { label: 'Transport des emails', ok: true, detail: transport === 'brevo' ? 'Brevo API (EMAIL_TRANSPORT=brevo)' : 'n8n send-email (par défaut)' },
    { label: 'Clé API Brevo', ok: Boolean(process.env.BREVO_API_KEY) || transport !== 'brevo', detail: process.env.BREVO_API_KEY ? 'Configurée' : 'Absente' },
    { label: 'URL n8n', ok: Boolean(process.env.N8N_WEBHOOK_URL), detail: process.env.N8N_WEBHOOK_URL ? 'Configurée' : 'Absente' },
    { label: 'Secret webhooks n8n', ok: Boolean(process.env.N8N_NOTIFICATION_WEBHOOK_SECRET), detail: process.env.N8N_NOTIFICATION_WEBHOOK_SECRET ? 'Configuré' : 'Absent' },
    { label: 'Secret des schedulers', ok: Boolean(process.env.DAILY_DIGEST_CRON_SECRET), detail: process.env.DAILY_DIGEST_CRON_SECRET ? 'Configuré' : 'Absent' },
  ];

  const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const since24h = now.getTime() - 86_400_000;
  const overdueBefore = new Date(now.getTime() - OVERDUE_RETRY_MINUTES * 60_000).toISOString();

  const greenApi = readGreenApiOutboundConfig();
  const [brevo, deliveries, overdue, stuck, lastAccepted, digestSettings, digestRun, recipients, whatsappRecipients, flagEnabled, instance, waRows, waErrors] = await Promise.all([
    process.env.BREVO_API_KEY ? checkBrevoAccount() : Promise.resolve(null),
    db.from('notification_deliveries').select('status, created_at').eq('tenant_id', tenantId).gte('created_at', since7d).limit(10_000),
    db.from('notification_deliveries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
      .eq('status', 'failed').not('payload', 'is', null).lt('next_attempt_at', overdueBefore),
    db.from('notification_deliveries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
      .eq('status', 'processing').lt('locked_until', overdueBefore),
    db.from('notification_deliveries').select('accepted_at').eq('tenant_id', tenantId).eq('status', 'accepted')
      .order('accepted_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('tenant_feature_settings').select('enabled, config').eq('tenant_id', tenantId).eq('feature_key', 'daily_order_digest').maybeSingle(),
    db.from('tenant_daily_digest_runs').select('local_date, status, accepted_at, error_code').eq('tenant_id', tenantId)
      .order('local_date', { ascending: false }).limit(1).maybeSingle(),
    countSubscribersByType(db, tenantId).catch((error: unknown) => {
      console.error('[notificationHealth] subscribers unavailable', error);
      return {} as Record<string, number>;
    }),
    countSubscribersByType(db, tenantId, 'whatsapp').catch(() => ({} as Record<string, number>)),
    isFeatureEnabled(tenantId, STAFF_WHATSAPP_FLAG),
    greenApi.ok ? getGreenApiInstanceState(greenApi.config) : Promise.resolve(null),
    db.from('notification_deliveries').select('status, created_at, next_attempt_at').eq('tenant_id', tenantId).eq('channel', 'whatsapp')
      .gte('created_at', since7d).limit(5000),
    db.from('notification_deliveries').select('updated_at, last_error').eq('tenant_id', tenantId).eq('channel', 'whatsapp')
      .in('status', ['failed', 'dead', 'unknown']).order('updated_at', { ascending: false }).limit(5),
  ]);
  const wa = (waRows.data ?? []) as Array<{ status: string; created_at: string; next_attempt_at: string }>;

  const rows = (deliveries.data ?? []) as Array<{ status: string; created_at: string }>;
  const run = digestRun.data as { local_date: string; status: string; accepted_at: string | null; error_code: string | null } | null;
  const settings = digestSettings.data as { enabled: boolean; config: { timezone?: string } | null } | null;

  return {
    transport,
    config,
    brevo,
    ledger: {
      available: !deliveries.error,
      last24h: countByStatus(rows.filter((row) => Date.parse(row.created_at) >= since24h)),
      last7d: countByStatus(rows),
      overdueRetries: overdue.count ?? 0,
      stuckProcessing: stuck.count ?? 0,
      lastAcceptedAt: (lastAccepted.data as { accepted_at: string | null } | null)?.accepted_at ?? null,
    },
    digest: {
      enabled: digestSettings.error ? null : Boolean(settings?.enabled),
      timezone: settings?.config?.timezone ?? (settings ? 'Europe/Rome' : null),
      lastRun: run ? { localDate: run.local_date, status: run.status, acceptedAt: run.accepted_at, errorCode: run.error_code } : null,
    },
    recipients: NOTIFICATION_TYPES.map((type) => ({
      type: type.key, label: type.label, count: recipients[type.key] ?? 0,
      whatsapp: (type.channels as ReadonlyArray<string>).includes('whatsapp') ? (whatsappRecipients as Record<string, number>)[type.key] ?? 0 : null,
    })),
    whatsapp: {
      flagEnabled,
      configured: greenApi.ok,
      configSource: greenApi.ok ? greenApi.config.source : null,
      configDetail: greenApi.ok ? null : `${greenApi.reason === 'missing' ? 'Variables absentes' : 'Variable invalide'} : ${greenApi.detail}`,
      instance,
      checkedAt: now.toISOString(),
      queued: wa.filter((row) => row.status === 'pending' || row.status === 'processing').length,
      retriesDue: wa.filter((row) => row.status === 'failed' && Date.parse(row.next_attempt_at) <= now.getTime()).length,
      unknown: wa.filter((row) => row.status === 'unknown').length,
      last24h: countByStatus(wa.filter((row) => Date.parse(row.created_at) >= since24h)),
      recentErrors: ((waErrors.data ?? []) as Array<{ updated_at: string; last_error: string | null }>)
        .filter((row) => row.last_error).map((row) => ({ at: row.updated_at, error: row.last_error!, label: greenApiErrorLabel(row.last_error) })),
    },
  };
}

/** Overall level shown at the top of the page. */
export function overallHealth(health: NotificationHealth): HealthLevel {
  if (health.config.some((item) => !item.ok) || (health.transport === 'brevo' && health.brevo && !health.brevo.ok)) return 'error';
  if (health.whatsapp.flagEnabled && (!health.whatsapp.configured || health.whatsapp.instance?.ok === false)) return 'error';
  if (health.whatsapp.unknown > 0 || (health.whatsapp.last24h.dead ?? 0) > 0) return 'warning';
  if (health.ledger.overdueRetries > 0 || health.ledger.stuckProcessing > 0 || (health.ledger.last24h.dead ?? 0) > 0
    || health.digest.lastRun?.status === 'failed') return 'warning';
  return 'ok';
}
