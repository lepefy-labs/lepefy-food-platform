import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import {
  executeAccountDeletion,
  type AccountDeletionOperations,
  type AccountDeletionRequestState,
  type AccountDeletionRequestStatus,
  type AccountDeletionResult,
} from './accountDeletionCore';

type ServiceClient = ReturnType<typeof createServiceClient>;

function assertNoError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

function createOperations(
  tenantId: string,
  userId: string,
  customerId: string | null,
  sessionClient: SupabaseClient,
  service: ServiceClient,
): AccountDeletionOperations {
  async function findRequest(): Promise<AccountDeletionRequestState | null> {
    const { data, error } = await service
      .from('account_deletion_requests')
      .select('id, status, reason_code')
      .eq('tenant_id', tenantId)
      .eq('auth_user_id', userId)
      .maybeSingle();
    assertNoError(error, 'find deletion request');
    return data ? { id: data.id, status: data.status, reasonCode: data.reason_code } : null;
  }

  return {
    async customerExists() {
      return !!customerId;
    },

    findRequest,

    async ensureRequest() {
      const existing = await findRequest();
      if (existing) return existing;

      const { data, error } = await service
        .from('account_deletion_requests')
        .insert({ tenant_id: tenantId, customer_id: customerId, auth_user_id: userId, status: 'processing' })
        .select('id, status, reason_code')
        .single();

      if (error) {
        const raced = await findRequest();
        if (raced) return raced;
        throw error;
      }
      return { id: data.id, status: data.status, reasonCode: data.reason_code };
    },

    async hasAdminIdentity() {
      const { data, error } = await service
        .from('admin_users')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      assertNoError(error, 'check admin identity');
      return !!data;
    },

    async hasUnpaidAmbassadorObligation() {
      const { data, error } = await service
        .from('ambassador_commissions')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('ambassador_customer_id', customerId ?? '')
        .eq('status', 'CONFIRMED')
        .limit(1)
        .maybeSingle();
      assertNoError(error, 'check ambassador obligations');
      return !!data;
    },

    async markRequest(id: string, status: AccountDeletionRequestStatus, reasonCode: string | null) {
      const completed = status === 'completed';
      const { error } = await service
        .from('account_deletion_requests')
        .update({
          status,
          reason_code: reasonCode,
          processed_at: completed ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      assertNoError(error, 'update deletion request');
    },

    async deleteCustomerData() {
      const { data, error } = await service.rpc('delete_customer_account_data', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
      });
      assertNoError(error, 'delete customer data');
      if (data !== true) throw new Error('delete customer data: customer not found');
    },

    async deleteAuthIdentity() {
      const { error } = await service.auth.admin.deleteUser(userId);
      assertNoError(error, 'delete auth identity');
    },

    async clearSession() {
      await sessionClient.auth.signOut({ scope: 'local' });
    },
  };
}

export async function deleteCustomerAccount(sessionClient: SupabaseClient): Promise<AccountDeletionResult> {
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return executeAccountDeletion(null);

  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const service = createServiceClient();
  const { data: customer, error } = await service.from('customers').select('id')
    .eq('tenant_id', tenant.id).eq('auth_user_id', user.id).maybeSingle();
  assertNoError(error, 'resolve customer');
  return executeAccountDeletion(user.id, createOperations(tenant.id, user.id, customer?.id ?? null, sessionClient, service));
}
