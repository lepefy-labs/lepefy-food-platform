import { createServiceClient } from '@/lib/supabase/server';
import { normalizeCustomerEmail, normalizeCustomerPhone } from './normalizeCustomerIdentity';
import type { CustomerSource } from '@lepefy/types';
import { selectAuthCustomerCandidate, selectCustomerCandidate } from './customerResolutionCore';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface ResolveCustomerInput {
  tenantId: string;
  authUserId?: string | null;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  source: CustomerSource;
  supabase?: ServiceClient;
}

export interface ResolvedCustomer {
  id: string;
  created: boolean;
  accountLinked: boolean;
}

interface IdentityRow { id: string; tenant_id: string; auth_user_id: string | null }

async function recordIdentityEvent(
  supabase: ServiceClient,
  tenantId: string,
  customerId: string,
  eventType: 'customer_created' | 'account_linked',
  source: string,
) {
  const eventKey = eventType === 'account_linked' ? `account_linked:${customerId}` : `customer_created:${customerId}`;
  const { error } = await supabase.from('customer_events').upsert({
    tenant_id: tenantId,
    customer_id: customerId,
    event_type: eventType,
    source,
    entity_type: 'customer',
    entity_id: customerId,
    event_key: eventKey,
  }, { onConflict: 'tenant_id,event_key', ignoreDuplicates: true });
  if (error) console.warn('[customer-resolver] identity event unavailable:', error.message);
}

export async function resolveOrCreateCustomer(input: ResolveCustomerInput): Promise<ResolvedCustomer> {
  const supabase = input.supabase ?? createServiceClient();
  const email = normalizeCustomerEmail(input.email);
  const phone = normalizeCustomerPhone(input.phone);
  const fullName = input.fullName?.trim() || null;

  if (!email && !phone && !fullName) throw new Error('customer_identity_required');

  if (input.authUserId) {
    const { data, error } = await supabase.from('customers').select('id, tenant_id, auth_user_id')
      .eq('tenant_id', input.tenantId).eq('auth_user_id', input.authUserId).maybeSingle<IdentityRow>();
    if (error) throw error;
    const selected = selectAuthCustomerCandidate(input.tenantId, input.authUserId, data ? [data] : []);
    if (selected) return { id: selected.id, created: false, accountLinked: false };
  }

  let matches: IdentityRow[] = [];
  if (email) {
    const [normalized, legacy] = await Promise.all([
      supabase.from('customers').select('id, tenant_id, auth_user_id').eq('tenant_id', input.tenantId).eq('normalized_email', email).limit(2),
      supabase.from('customers').select('id, tenant_id, auth_user_id').eq('tenant_id', input.tenantId).ilike('email', email).limit(3),
    ]);
    if (normalized.error) throw normalized.error;
    if (legacy.error) throw legacy.error;
    matches = [...new Map<string, IdentityRow>([...(normalized.data ?? []), ...(legacy.data ?? [])]
      .map((row): [string, IdentityRow] => [row.id, row as IdentityRow])).values()];
    const selected = selectCustomerCandidate(input.tenantId, matches, 'customer_email_collision');
    matches = selected ? [selected] : [];
  }

  if (matches.length === 0 && phone && phone.replace(/\D/g, '').length >= 8) {
    const { data, error } = await supabase.from('customers').select('id, tenant_id, auth_user_id')
      .eq('tenant_id', input.tenantId).eq('normalized_phone', phone).limit(2);
    if (error) throw error;
    matches = (data ?? []) as IdentityRow[];
    const selected = selectCustomerCandidate(input.tenantId, matches, 'customer_phone_collision');
    matches = selected ? [selected] : [];
  }

  const existing = matches[0];
  if (existing) {
    let accountLinked = false;
    if (input.authUserId) {
      if (existing.auth_user_id && existing.auth_user_id !== input.authUserId) throw new Error('customer_account_collision');
      const { data: conflicting } = await supabase.from('customers').select('id')
        .eq('tenant_id', input.tenantId).eq('auth_user_id', input.authUserId).neq('id', existing.id).maybeSingle();
      if (conflicting) throw new Error('auth_user_customer_collision');
      if (!existing.auth_user_id) {
        const { data: linked, error } = await supabase.from('customers').update({ auth_user_id: input.authUserId })
          .eq('tenant_id', input.tenantId).eq('id', existing.id).is('auth_user_id', null)
          .select('id').maybeSingle();
        if (error) throw error;
        if (linked) {
          accountLinked = true;
          await recordIdentityEvent(supabase, input.tenantId, existing.id, 'account_linked', input.source);
        } else {
          const { data: raced, error: raceError } = await supabase.from('customers').select('auth_user_id')
            .eq('tenant_id', input.tenantId).eq('id', existing.id).single();
          if (raceError) throw raceError;
          if (raced.auth_user_id !== input.authUserId) throw new Error('customer_account_collision');
        }
      }
    }
    return { id: existing.id, created: false, accountLinked };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from('customers').insert({
    id,
    tenant_id: input.tenantId,
    auth_user_id: input.authUserId ?? null,
    email,
    normalized_email: email,
    full_name: fullName,
    phone: input.phone?.trim() || null,
    normalized_phone: phone,
    source: input.source,
  });
  if (error) {
    // Concurrent checkout/signup requests can both observe no row before the
    // normalized identity constraint serializes the insert. Resolve once more
    // so the losing request reuses the winner instead of creating a duplicate.
    if ((error as { code?: string }).code === '23505') return resolveOrCreateCustomer(input);
    throw error;
  }
  await recordIdentityEvent(supabase, input.tenantId, id, 'customer_created', input.source);
  return { id, created: true, accountLinked: false };
}
