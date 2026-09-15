export interface CustomerIdentityCandidate { id: string; tenant_id: string; auth_user_id: string | null }

export function selectAuthCustomerCandidate(
  tenantId: string,
  authUserId: string,
  candidates: CustomerIdentityCandidate[],
): CustomerIdentityCandidate | null {
  return selectCustomerCandidate(
    tenantId,
    candidates.filter((row) => row.auth_user_id === authUserId),
    'auth_user_customer_collision',
  );
}

export function selectCustomerCandidate(
  tenantId: string,
  candidates: CustomerIdentityCandidate[],
  collisionCode: string,
): CustomerIdentityCandidate | null {
  const scoped = [...new Map(candidates.filter((row) => row.tenant_id === tenantId).map((row) => [row.id, row])).values()];
  if (scoped.length > 1) throw new Error(collisionCode);
  return scoped[0] ?? null;
}
