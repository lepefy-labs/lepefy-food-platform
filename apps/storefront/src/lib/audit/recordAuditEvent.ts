import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type { AdminAccessContext } from '@/lib/auth/adminRbac';
import { adminActorLabel } from './requestContext';
import { sanitizeAuditJson } from './sanitize';
import type { NativeAuditEventType } from './eventCatalog';

export interface AppAuditEvent {
  tenantId: string | null;
  eventType: NativeAuditEventType;
  actor: AdminAccessContext;
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  metadata?: Record<string, unknown>;
  outcome?: 'success' | 'failure';
  /** Idempotency: the same key never produces a second event for the tenant. */
  eventKey?: string;
}

/**
 * Application events with no database row behind them (export, privileged
 * view). Through record_audit_event, like the triggers. Never throws: the
 * caller's action is not blocked by the journal, the failure is logged.
 */
export async function recordAuditEvent(event: AppAuditEvent): Promise<boolean> {
  try {
    const { error } = await createServiceClient().rpc('record_audit_event', {
      p_tenant_id: event.tenantId,
      p_event_type: event.eventType,
      p_resource_type: event.resourceType ?? null,
      p_resource_id: event.resourceId ?? null,
      p_resource_label: event.resourceLabel ?? null,
      p_changes: [],
      p_metadata: sanitizeAuditJson(event.metadata ?? {}),
      p_outcome: event.outcome ?? 'success',
      p_severity: null,
      p_actor: {
        actor_type: event.actor.isPlatformOwner ? 'platform_owner' : 'admin',
        actor_admin_id: event.actor.userId,
        actor_label: adminActorLabel(event.actor),
        source: 'app',
      },
      p_event_key: event.eventKey ?? null,
      p_occurred_at: null,
    });
    if (error) {
      console.error('[audit] app event not recorded — type:', event.eventType, '— code:', error.code ?? 'unknown');
      return false;
    }
    return true;
  } catch {
    console.error('[audit] app event not recorded — type:', event.eventType);
    return false;
  }
}
