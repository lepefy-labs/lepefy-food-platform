export type AccountDeletionStatus = 'completed' | 'manual_review' | 'failed';
export type AccountDeletionFailureReason =
  | 'unauthenticated'
  | 'customer_not_found'
  | 'request_state_failed'
  | 'cleanup_failed'
  | 'auth_delete_failed';
export type AccountDeletionManualReason = 'admin_identity' | 'unpaid_ambassador_commission';
export type AccountDeletionRequestStatus = 'processing' | 'manual_review' | 'completed' | 'failed';

export interface AccountDeletionResult {
  status: AccountDeletionStatus;
  reason?: AccountDeletionFailureReason | AccountDeletionManualReason;
}

export interface AccountDeletionRequestState {
  id: string;
  status: AccountDeletionRequestStatus;
  reasonCode: string | null;
}

export interface AccountDeletionOperations {
  customerExists(): Promise<boolean>;
  findRequest(): Promise<AccountDeletionRequestState | null>;
  ensureRequest(): Promise<AccountDeletionRequestState>;
  hasAdminIdentity(): Promise<boolean>;
  hasUnpaidAmbassadorObligation(): Promise<boolean>;
  markRequest(id: string, status: AccountDeletionRequestStatus, reasonCode: string | null): Promise<void>;
  deleteCustomerData(): Promise<void>;
  deleteAuthIdentity(): Promise<void>;
  clearSession(): Promise<void>;
}

export function normalizeAccountDeletionEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function buildAccountDeletionOtpRequest(email: string) {
  return {
    email,
    options: { shouldCreateUser: false as const },
  };
}

export function deletionOtpBelongsToCustomer(sessionUserId: string | null, customerId: string | null): boolean {
  return !!sessionUserId && sessionUserId === customerId;
}

async function bestEffortMark(
  operations: AccountDeletionOperations,
  id: string,
  status: AccountDeletionRequestStatus,
  reasonCode: string | null,
) {
  try {
    await operations.markRequest(id, status, reasonCode);
  } catch {
    // The destructive outcome takes precedence; a processing row remains retryable.
  }
}

export async function executeAccountDeletion(
  userId: string | null,
  operations?: AccountDeletionOperations,
): Promise<AccountDeletionResult> {
  if (!userId || !operations) return { status: 'failed', reason: 'unauthenticated' };

  const [customerExists, existingRequest] = await Promise.all([
    operations.customerExists(),
    operations.findRequest(),
  ]);

  if (!customerExists) {
    if (!existingRequest) return { status: 'failed', reason: 'customer_not_found' };
    if (existingRequest.status === 'completed') {
      await operations.clearSession();
      return { status: 'completed' };
    }
    if (existingRequest.status === 'manual_review') {
      return { status: 'manual_review' };
    }
    if (await operations.hasAdminIdentity()) {
      await bestEffortMark(operations, existingRequest.id, 'manual_review', 'admin_identity');
      return { status: 'manual_review', reason: 'admin_identity' };
    }

    try {
      await operations.deleteAuthIdentity();
    } catch {
      await bestEffortMark(operations, existingRequest.id, 'failed', 'auth_delete_failed');
      return { status: 'failed', reason: 'auth_delete_failed' };
    }

    await operations.clearSession();
    await bestEffortMark(operations, existingRequest.id, 'completed', null);
    return { status: 'completed' };
  }

  let request: AccountDeletionRequestState;
  try {
    request = existingRequest ?? await operations.ensureRequest();
  } catch {
    return { status: 'failed', reason: 'request_state_failed' };
  }

  const [hasAdminIdentity, hasUnpaidAmbassadorObligation] = await Promise.all([
    operations.hasAdminIdentity(),
    operations.hasUnpaidAmbassadorObligation(),
  ]);

  if (hasAdminIdentity || hasUnpaidAmbassadorObligation) {
    const reason = hasAdminIdentity ? 'admin_identity' : 'unpaid_ambassador_commission';
    await bestEffortMark(operations, request.id, 'manual_review', reason);
    return { status: 'manual_review', reason };
  }

  try {
    await operations.markRequest(request.id, 'processing', null);
  } catch {
    return { status: 'failed', reason: 'request_state_failed' };
  }

  try {
    await operations.deleteCustomerData();
  } catch {
    await bestEffortMark(operations, request.id, 'failed', 'cleanup_failed');
    return { status: 'failed', reason: 'cleanup_failed' };
  }

  try {
    await operations.deleteAuthIdentity();
  } catch {
    await bestEffortMark(operations, request.id, 'failed', 'auth_delete_failed');
    return { status: 'failed', reason: 'auth_delete_failed' };
  }

  await operations.clearSession();
  await bestEffortMark(operations, request.id, 'completed', null);
  return { status: 'completed' };
}
