import type { SupabaseClient } from '@supabase/supabase-js';
import { NOTIFICATION_TYPES } from '@/lib/notifications/notificationTypes';
import { countSubscribersByType } from '@/lib/notifications/notificationSubscriptions';
import { checkBrevoAccount, configuredEmailTransport, type BrevoAccountStatus, type EmailTransportName } from '@/lib/notifications/emailTransport';

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
  /** Deliverable subscribers per notification type (whole catalogue). */
  recipients: Array<{ type: string; label: string; count: number }>;
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

  const [brevo, deliveries, overdue, stuck, lastAccepted, digestSettings, digestRun, recipients] = await Promise.all([
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
  ]);

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
    recipients: NOTIFICATION_TYPES.map((type) => ({ type: type.key, label: type.label, count: recipients[type.key] ?? 0 })),
  };
}

/** Overall level shown at the top of the page. */
export function overallHealth(health: NotificationHealth): HealthLevel {
  if (health.config.some((item) => !item.ok) || (health.transport === 'brevo' && health.brevo && !health.brevo.ok)) return 'error';
  if (health.ledger.overdueRetries > 0 || health.ledger.stuckProcessing > 0 || (health.ledger.last24h.dead ?? 0) > 0
    || health.digest.lastRun?.status === 'failed') return 'warning';
  return 'ok';
}
