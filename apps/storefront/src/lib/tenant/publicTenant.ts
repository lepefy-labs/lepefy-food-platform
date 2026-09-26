import { PUBLIC_TENANT_FIELDS, type PublicTenant, type Tenant } from '@lepefy/types';

/**
 * Builds the only tenant shape allowed to cross the server → client boundary.
 * Copies the allow-listed keys instead of spreading and blanking secrets, so a
 * new tenants column is private by default.
 */
export function toPublicTenant(tenant: Tenant): PublicTenant {
  const projection: Record<string, unknown> = {};
  for (const field of PUBLIC_TENANT_FIELDS) projection[field] = tenant[field];
  return projection as PublicTenant;
}
