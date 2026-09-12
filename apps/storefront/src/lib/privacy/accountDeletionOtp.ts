import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  buildAccountDeletionOtpRequest,
  deletionOtpBelongsToCustomer,
  normalizeAccountDeletionEmail,
} from './accountDeletionCore';

export async function requestAccountDeletionOtp(
  rawEmail: unknown,
  tenantId: string,
): Promise<{ sent: boolean; invalid?: boolean }> {
  const email = normalizeAccountDeletionEmail(rawEmail);
  if (!email) return { sent: false, invalid: true };

  const { data: customer, error: customerError } = await createServiceClient()
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('email', email)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!customer) return { sent: true };

  const { error } = await createClient().auth.signInWithOtp(buildAccountDeletionOtpRequest(email));
  if (error) throw error;
  return { sent: true };
}

export async function verifyAccountDeletionOtp(
  sessionClient: SupabaseClient,
  rawEmail: unknown,
  rawToken: unknown,
  tenantId: string,
): Promise<{ session: Session | null; invalid?: boolean }> {
  const email = normalizeAccountDeletionEmail(rawEmail);
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!email || !/^\d{6}$/.test(token)) return { session: null, invalid: true };

  const { data, error } = await sessionClient.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data.session) return { session: null };

  const { data: customer, error: customerError } = await createServiceClient()
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', data.session.user.id)
    .ilike('email', email)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!deletionOtpBelongsToCustomer(data.session.user.id, customer?.id ?? null)) {
    await sessionClient.auth.signOut({ scope: 'local' });
    return { session: null };
  }

  return { session: data.session };
}
