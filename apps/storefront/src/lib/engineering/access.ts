/**
 * Who may use the Engineering Hub (docs/engineering/SECURITY.md).
 *
 * Pure decision, no I/O. NEVER use `canAdmin()` for these permissions: it lets a
 * `tenant_admin` pass every non-`platform.` permission. The Hub accepts only the
 * platform owner and, once explicitly enabled, members whose role has PLATFORM scope.
 */
export const ENGINEERING_PERMISSIONS = ['engineering.view', 'engineering.ai.use', 'engineering.manage', 'engineering.admin'] as const;
export type EngineeringPermission = (typeof ENGINEERING_PERMISSIONS)[number];

/**
 * Phase 1 is Platform Owner only. Opening the Hub to IT members needs the separately
 * approved change of `platform/layout.tsx`; until then this stays false so that an
 * IT-role membership cannot reach the APIs either.
 */
export const MEMBER_ACCESS_ENABLED = false;

export interface EngineeringAccessSubject {
  isPlatformOwner: boolean;
  scope: 'tenant' | 'platform';
  permissions: string[];
}

export function canAccessEngineering(
  subject: EngineeringAccessSubject | null,
  permission: EngineeringPermission,
  options: { memberAccessEnabled?: boolean } = {},
): boolean {
  if (!subject) return false;
  if (subject.isPlatformOwner) return true;
  if (!(options.memberAccessEnabled ?? MEMBER_ACCESS_ENABLED)) return false;
  return subject.scope === 'platform' && subject.permissions.includes(permission);
}
