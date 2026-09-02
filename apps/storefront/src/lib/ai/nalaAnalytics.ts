import type { NextRequest } from 'next/server';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { hasTenantFeature, PLATFORM_FEATURE_KEYS } from '@/lib/entitlements/tenantEntitlements';
import { createServiceClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_TYPES = new Set(['mobile', 'tablet', 'desktop', 'unknown']);

export type NalaOutcome = 'small_talk' | 'rate_limited' | 'answered' | 'retrieval_empty' | 'error';

export interface NalaAnalyticsContext {
  tenantId: string;
  clientSessionId: string;
  customerId: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  locale: string | null;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  sourcePath: string | null;
}

interface PrepareNalaAnalyticsParams {
  request: NextRequest;
  tenantId: string;
  clientSessionId: unknown;
  sourcePath: unknown;
  locale: unknown;
  deviceType: unknown;
}

interface LogNalaInteractionParams {
  context: NalaAnalyticsContext | null;
  messageText: string;
  replyText: string | null;
  aiCallTriggered: boolean;
  outcome: NalaOutcome;
  intent?: string | null;
  matchedProductIds?: string[] | null;
  matchedKbIds?: string[] | null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

function cleanSourcePath(value: unknown): string | null {
  const path = cleanText(value, 500);
  return path?.startsWith('/') ? path : null;
}

function cleanLocale(value: unknown): string | null {
  const locale = cleanText(value, 35);
  if (!locale) return null;
  const normalized = locale.replace(/_/g, '-');
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized) ? normalized : null;
}

function cleanHeader(value: string | null, maxLength: number): string | null {
  return cleanText(value, maxLength);
}

function decodeCity(value: string | null): string | null {
  if (!value) return null;
  try {
    return cleanText(decodeURIComponent(value), 120);
  } catch {
    return null;
  }
}

function requestGeography(request: NextRequest) {
  if (process.env.VERCEL !== '1') {
    return { countryCode: null, region: null, city: null };
  }

  const country = request.headers.get('x-vercel-ip-country')?.toUpperCase() ?? null;
  return {
    countryCode: country && /^[A-Z]{2}$/.test(country) ? country : null,
    region: cleanHeader(request.headers.get('x-vercel-ip-country-region'), 100),
    city: decodeCity(request.headers.get('x-vercel-ip-city')),
  };
}

export async function prepareNalaAnalytics(
  params: PrepareNalaAnalyticsParams,
): Promise<NalaAnalyticsContext | null> {
  if (typeof params.clientSessionId !== 'string' || !UUID_PATTERN.test(params.clientSessionId)) {
    return null;
  }

  try {
    const entitled = await hasTenantFeature(params.tenantId, PLATFORM_FEATURE_KEYS.nalaAnalytics);
    if (!entitled) return null;

    const customer = await getSessionCustomer(params.tenantId);
    const geography = requestGeography(params.request);
    const deviceType = typeof params.deviceType === 'string' && DEVICE_TYPES.has(params.deviceType)
      ? params.deviceType as NalaAnalyticsContext['deviceType']
      : 'unknown';

    return {
      tenantId: params.tenantId,
      clientSessionId: params.clientSessionId,
      customerId: customer?.id ?? null,
      ...geography,
      locale: cleanLocale(params.locale),
      deviceType,
      sourcePath: cleanSourcePath(params.sourcePath),
    };
  } catch (error) {
    console.error('[nala-analytics] Analytics entitlement or context resolution failed; skipping.', {
      tenantId: params.tenantId,
      error,
    });
    return null;
  }
}

export async function logNalaInteraction(params: LogNalaInteractionParams): Promise<string | null> {
  if (!params.context) return null;

  try {
    const service = createServiceClient();
    const { data: sessionId, error: sessionError } = await service.rpc('resolve_nala_session', {
      p_tenant_id: params.context.tenantId,
      p_client_session_id: params.context.clientSessionId,
      p_customer_id: params.context.customerId,
      p_country_code: params.context.countryCode,
      p_region: params.context.region,
      p_city: params.context.city,
      p_locale: params.context.locale,
      p_device_type: params.context.deviceType,
      p_entry_path: params.context.sourcePath,
    });

    if (sessionError || !sessionId) {
      throw new Error(sessionError?.message ?? 'Nala analytics session was not resolved');
    }

    const { data: interaction, error: interactionError } = await service.from('nala_interactions').insert({
      tenant_id: params.context.tenantId,
      session_id: sessionId,
      message_text: params.messageText,
      reply_text: params.replyText,
      source_path: params.context.sourcePath,
      ai_call_triggered: params.aiCallTriggered,
      outcome: params.outcome,
      intent: params.intent ?? null,
      matched_product_ids: params.matchedProductIds ?? null,
      matched_kb_ids: params.matchedKbIds ?? null,
    }).select('id').single();

    if (interactionError || !interaction) throw new Error(interactionError?.message ?? 'Nala interaction was not created');
    return interaction.id;
  } catch (error) {
    console.error('[nala-analytics] Best-effort interaction logging failed.', {
      tenantId: params.context.tenantId,
      outcome: params.outcome,
      error,
    });
    return null;
  }
}
