import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAccountDeletionOtpRequest,
  deletionOtpBelongsToCustomer,
  executeAccountDeletion,
  normalizeAccountDeletionEmail,
  type AccountDeletionOperations,
  type AccountDeletionRequestState,
} from '@/lib/privacy/accountDeletionCore';

function operations(overrides: Partial<AccountDeletionOperations> = {}) {
  const calls: string[] = [];
  const request: AccountDeletionRequestState = { id: 'request-1', status: 'processing', reasonCode: null };
  const base: AccountDeletionOperations = {
    customerExists: async () => { calls.push('customer'); return true; },
    findRequest: async () => { calls.push('find-request'); return null; },
    ensureRequest: async () => { calls.push('ensure-request'); return request; },
    hasAdminIdentity: async () => { calls.push('admin-check'); return false; },
    hasUnpaidAmbassadorObligation: async () => { calls.push('ambassador-check'); return false; },
    markRequest: async (_id, status) => { calls.push(`mark:${status}`); },
    deleteCustomerData: async () => { calls.push('delete-data'); },
    deleteAuthIdentity: async () => { calls.push('delete-auth'); },
    clearSession: async () => { calls.push('clear-session'); },
  };
  return { calls, value: { ...base, ...overrides } };
}

test('deletion OTP never enables user creation', () => {
  expect(buildAccountDeletionOtpRequest('client@example.test')).toEqual({
    email: 'client@example.test',
    options: { shouldCreateUser: false },
  });
});

test('deletion email is normalized and malformed input is rejected', () => {
  expect(normalizeAccountDeletionEmail('  Client@Example.Test ')).toBe('client@example.test');
  expect(normalizeAccountDeletionEmail('not-an-email')).toBeNull();
  expect(normalizeAccountDeletionEmail(null)).toBeNull();
});

test('OTP session must resolve to the tenant customer identity', () => {
  expect(deletionOtpBelongsToCustomer('customer-a', 'customer-a')).toBe(true);
  expect(deletionOtpBelongsToCustomer('customer-a', 'customer-b')).toBe(false);
  expect(deletionOtpBelongsToCustomer('customer-a', null)).toBe(false);
});

test('unauthenticated deletion is rejected before any operation', async () => {
  const { calls, value } = operations();
  expect(await executeAccountDeletion(null, value)).toEqual({ status: 'failed', reason: 'unauthenticated' });
  expect(calls).toEqual([]);
});

test('wrong-tenant or missing customer is rejected without Auth deletion', async () => {
  const { calls, value } = operations({
    customerExists: async () => false,
    findRequest: async () => null,
  });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'failed', reason: 'customer_not_found' });
  expect(calls).not.toContain('delete-auth');
});

test('admin identity forces manual review and preserves Auth', async () => {
  const { calls, value } = operations({ hasAdminIdentity: async () => true });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'manual_review', reason: 'admin_identity' });
  expect(calls).not.toContain('delete-data');
  expect(calls).not.toContain('delete-auth');
});

test('unpaid ambassador obligation forces manual review', async () => {
  const { calls, value } = operations({ hasUnpaidAmbassadorObligation: async () => true });
  expect(await executeAccountDeletion('user-a', value)).toEqual({
    status: 'manual_review',
    reason: 'unpaid_ambassador_commission',
  });
  expect(calls).not.toContain('delete-auth');
});

test('successful deletion removes data before Auth and then clears session', async () => {
  const { calls, value } = operations();
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'completed' });
  expect(calls.indexOf('delete-data')).toBeLessThan(calls.indexOf('delete-auth'));
  expect(calls.indexOf('delete-auth')).toBeLessThan(calls.indexOf('clear-session'));
  expect(calls).toContain('mark:completed');
});

test('cleanup failure never deletes Auth', async () => {
  const { calls, value } = operations({
    deleteCustomerData: async () => { calls.push('delete-data'); throw new Error('db'); },
  });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'failed', reason: 'cleanup_failed' });
  expect(calls).not.toContain('delete-auth');
  expect(calls).toContain('mark:failed');
});

test('Auth failure remains retryable and does not claim completion', async () => {
  const { calls, value } = operations({
    deleteAuthIdentity: async () => { calls.push('delete-auth'); throw new Error('auth'); },
  });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'failed', reason: 'auth_delete_failed' });
  expect(calls).not.toContain('clear-session');
  expect(calls).not.toContain('mark:completed');
});

test('retry after customer cleanup deletes only the remaining Auth identity', async () => {
  const request = { id: 'request-1', status: 'failed' as const, reasonCode: 'auth_delete_failed' };
  const { calls, value } = operations({
    customerExists: async () => false,
    findRequest: async () => request,
  });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'completed' });
  expect(calls).not.toContain('delete-data');
  expect(calls.indexOf('delete-auth')).toBeLessThan(calls.indexOf('clear-session'));
});

test('repeated completed request is idempotent', async () => {
  const request = { id: 'request-1', status: 'completed' as const, reasonCode: null };
  const { calls, value } = operations({
    customerExists: async () => false,
    findRequest: async () => request,
  });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'completed' });
  expect(calls).not.toContain('delete-data');
  expect(calls).not.toContain('delete-auth');
  expect(calls).toContain('clear-session');
});

test('repeated manual-review request never deletes Auth', async () => {
  const request = { id: 'request-1', status: 'manual_review' as const, reasonCode: 'admin_identity' };
  const { calls, value } = operations({
    customerExists: async () => false,
    findRequest: async () => request,
  });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'manual_review' });
  expect(calls).not.toContain('delete-auth');
});

test('request-state failure prevents destructive work', async () => {
  const { calls, value } = operations({
    ensureRequest: async () => { throw new Error('state'); },
  });
  expect(await executeAccountDeletion('user-a', value)).toEqual({ status: 'failed', reason: 'request_state_failed' });
  expect(calls).not.toContain('delete-data');
  expect(calls).not.toContain('delete-auth');
});

test('OTP verification is non-destructive and never performs signup/upsert', () => {
  const otpSource = readFileSync(resolve(__dirname, '../../src/lib/privacy/accountDeletionOtp.ts'), 'utf8');
  const routeSource = readFileSync(
    resolve(__dirname, '../../src/app/api/privacy/account-deletion/verify-otp/route.ts'),
    'utf8',
  );
  expect(otpSource).not.toContain('.upsert(');
  expect(otpSource).not.toContain("type: 'signup'");
  expect(routeSource).not.toContain('deleteCustomerAccount');
  expect(routeSource).not.toContain('delete_customer_account_data');
});

test('the public UI requires a separate explicit confirmation before deletion', () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/app/(shop)/supprimer-compte/AccountDeletionClient.tsx'),
    'utf8',
  );
  expect(source).toContain("const [confirmed, setConfirmed] = useState(false)");
  expect(source).toContain("if (!confirmed || busy) return");
  expect(source).toContain("disabled={!confirmed || busy}");
});
