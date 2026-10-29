// Lepefy Auth Mailer — Supabase Send Email Hook (docs/AUTH_MAILER_MULTITENANT.md).
// Supabase keeps generating/verifying OTPs and sessions; this function only
// resolves the tenant (signed context), renders the email and hands it to Resend.
//
// Secrets (supabase secrets set): SEND_EMAIL_HOOK_SECRET (v1,whsec_…),
// AUTH_MAILER_CONTEXT_SECRET, RESEND_API_KEY. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// Optional: AUTH_MAIL_FROM_ADDRESS (must be @auth.lepefy.com), AUTH_OTP_EXPIRY_MINUTES.
import { handleAuthMailHook, type AuditEntry, type TenantMailConfig } from '../_shared/authMailer/handler.ts';
import { createResendTransport } from '../_shared/authMailer/resend.ts';
import { resolveFromAddress } from '../_shared/authMailer/sender.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

async function loadTenant(id: string): Promise<TenantMailConfig | null> {
  const [t, s] = await Promise.all([
    rest(`tenants?id=eq.${encodeURIComponent(id)}&select=id,name,active,logo_url,primary_color,locale,locales&limit=1`),
    rest(`tenant_auth_mail_settings?tenant_id=eq.${encodeURIComponent(id)}&select=enabled,sender_name_override,language&limit=1`),
  ]);
  if (!t.ok) return null;
  const tenant = ((await t.json()) as Array<Record<string, unknown>>)[0];
  if (!tenant) return null;
  // Settings are optional (migration 173 may be absent or the tenant not configured): defaults apply.
  const settings = s.ok ? ((await s.json()) as Array<Record<string, unknown>>)[0] : undefined;
  return {
    id: tenant.id as string,
    name: tenant.name as string,
    active: tenant.active === true,
    logoUrl: (tenant.logo_url as string | null) ?? null,
    color: (tenant.primary_color as string | null) ?? null,
    locale: (tenant.locale as string | null) ?? null,
    locales: Array.isArray(tenant.locales) ? (tenant.locales as string[]) : [],
    enabled: settings ? settings.enabled !== false : true,
    senderNameOverride: (settings?.sender_name_override as string | null) ?? null,
    languageOverride: (settings?.language as string | null) ?? null,
  };
}

async function audit(e: AuditEntry): Promise<void> {
  // Technical audit only: never the code, token, link or address.
  await rest('auth_mail_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: e.tenantId, kind: e.kind, email_action_type: e.emailActionType, provider: 'resend',
      outcome: e.outcome, error_code: e.errorCode, duration_ms: e.durationMs,
      provider_message_id: e.providerMessageId, correlation_id: e.correlationId,
    }),
  });
}

const expiry = Number(Deno.env.get('AUTH_OTP_EXPIRY_MINUTES'));

Deno.serve((req) =>
  handleAuthMailHook(req, {
    webhookSecret: Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '',
    contextSecret: Deno.env.get('AUTH_MAILER_CONTEXT_SECRET') ?? '',
    fromAddress: resolveFromAddress(Deno.env.get('AUTH_MAIL_FROM_ADDRESS')),
    otpExpiryMinutes: Number.isFinite(expiry) && expiry > 0 ? expiry : null,
    supabaseUrl: SUPABASE_URL,
    nowMs: () => Date.now(),
    loadTenant,
    transport: createResendTransport(Deno.env.get('RESEND_API_KEY') ?? ''),
    audit,
  }),
);
