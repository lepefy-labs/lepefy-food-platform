import { AUDIT_MODULES, AUDIT_MODULE_KEYS, type AuditCategory, type AuditModule } from './eventCatalog';

/** Release flag of the journal: only the platform owner can turn it on for a tenant. */
export const ACTIVITY_JOURNAL_FLAG = 'activity_journal';

export interface JournalScope {
  isPlatformOwner: boolean;
  /** Modules whose events this admin may read (source-module permission + module flag). */
  modules: AuditModule[];
  categories: AuditCategory[];
  canExport: boolean;
  canSeeSecurity: boolean;
  /** Global view: every tenant and platform-level events. */
  canSeePlatform: boolean;
}

export interface ScopeInput {
  isPlatformOwner: boolean;
  can: (permission: string) => boolean;
  flags: { business_management: boolean; whatsapp_business: boolean };
}

/**
 * Pure: which part of the feed an admin may read. The server passes the result
 * to the feed RPC, which returns no row outside it (fail-closed on empty).
 */
export function resolveJournalScope({ isPlatformOwner, can, flags }: ScopeInput): JournalScope {
  const canSeeSecurity = isPlatformOwner || can('audit.security.view');
  const modules = AUDIT_MODULE_KEYS.filter((key) => {
    if (isPlatformOwner) return true;
    const definition = AUDIT_MODULES[key] as { anyOf: readonly string[]; flag?: keyof ScopeInput['flags']; platformOnly?: boolean };
    if (definition.platformOnly) return false;
    if (definition.flag && !flags[definition.flag]) return false;
    return definition.anyOf.some((permission) => can(permission));
  });
  return {
    isPlatformOwner,
    modules,
    categories: canSeeSecurity ? ['activity', 'automation', 'security'] : ['activity', 'automation'],
    canExport: isPlatformOwner || can('audit.export'),
    canSeeSecurity,
    canSeePlatform: isPlatformOwner && can('platform.audit.view'),
  };
}
