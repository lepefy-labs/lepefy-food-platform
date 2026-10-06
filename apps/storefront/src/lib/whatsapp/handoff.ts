import type { WhatsAppLogger } from './log';
import type { WhatsAppConversationStatus, WhatsAppHandoffReason } from './types';

/**
 * Passage à un opérateur. Invariant : tant qu'une conversation est en
 * waiting_human / human, automation_status = 'paused' et l'automatisation ne
 * répond plus (decideAutomation). Reprise manuelle, ou automatique si le canal
 * définit auto_resume_minutes. Chaque transition est auditée.
 */

export interface ConversationPatch {
  status?: WhatsAppConversationStatus;
  automation_status?: 'active' | 'paused';
  assigned_to?: string | null;
  human_handoff_at?: string | null;
  automation_resume_at?: string | null;
  unread_count?: number;
}

export interface HandoffAuditEvent {
  tenantId: string;
  conversationId: string;
  eventType: 'handoff_requested' | 'agent_takeover' | 'automation_resumed' | 'automation_auto_resumed' | 'conversation_closed' | 'conversation_reopened';
  actorType: 'system' | 'admin' | 'customer';
  actorAdminId: string | null;
  detail: Record<string, string | number | boolean | null>;
}

export interface HandoffStore {
  /** Crée le handoff ouvert ; 'exists' si un handoff est déjà ouvert (index unique partiel). */
  openHandoff(row: {
    tenantId: string; conversationId: string; reason: WhatsAppHandoffReason; triggerMessageId: string | null;
    resumeAt: string | null; assignedTo: string | null; acceptedAt: string | null;
  }): Promise<'created' | 'exists'>;
  acceptOpenHandoff(tenantId: string, conversationId: string, adminId: string, at: string): Promise<void>;
  resolveOpenHandoffs(tenantId: string, conversationId: string, resolution: 'resumed' | 'closed' | 'auto_resumed', adminId: string | null, at: string): Promise<number>;
  updateConversation(tenantId: string, conversationId: string, patch: ConversationPatch): Promise<void>;
  audit(event: HandoffAuditEvent): Promise<void>;
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function requestHandoff(
  store: HandoffStore,
  params: {
    tenantId: string; conversationId: string; reason: WhatsAppHandoffReason; triggerMessageId: string | null;
    autoResumeMinutes: number | null; log: WhatsAppLogger; now?: number;
  },
): Promise<void> {
  const now = params.now ?? Date.now();
  const resumeAt = params.autoResumeMinutes ? iso(now + params.autoResumeMinutes * 60_000) : null;
  const created = await store.openHandoff({
    tenantId: params.tenantId, conversationId: params.conversationId, reason: params.reason,
    triggerMessageId: params.triggerMessageId, resumeAt, assignedTo: null, acceptedAt: null,
  });
  await store.updateConversation(params.tenantId, params.conversationId, {
    status: 'waiting_human', automation_status: 'paused', human_handoff_at: iso(now), automation_resume_at: resumeAt,
  });
  if (created === 'created') {
    await store.audit({
      tenantId: params.tenantId, conversationId: params.conversationId, eventType: 'handoff_requested',
      actorType: 'system', actorAdminId: null, detail: { reason: params.reason, auto_resume: Boolean(resumeAt) },
    });
  }
  params.log('handoff_requested', { tenantId: params.tenantId, conversationId: params.conversationId, reason: params.reason, created: created === 'created' });
}

/** Un opérateur prend la main (bouton « Prendre la main » ou premier message humain). */
export async function takeOverConversation(
  store: HandoffStore,
  params: { tenantId: string; conversationId: string; adminId: string; now?: number },
): Promise<void> {
  const at = iso(params.now ?? Date.now());
  const created = await store.openHandoff({
    tenantId: params.tenantId, conversationId: params.conversationId, reason: 'agent_takeover',
    triggerMessageId: null, resumeAt: null, assignedTo: params.adminId, acceptedAt: at,
  });
  if (created === 'exists') await store.acceptOpenHandoff(params.tenantId, params.conversationId, params.adminId, at);
  await store.updateConversation(params.tenantId, params.conversationId, {
    status: 'human', automation_status: 'paused', assigned_to: params.adminId, human_handoff_at: at,
    automation_resume_at: null, unread_count: 0,
  });
  await store.audit({
    tenantId: params.tenantId, conversationId: params.conversationId, eventType: 'agent_takeover',
    actorType: 'admin', actorAdminId: params.adminId, detail: {},
  });
}

export async function resumeAutomation(
  store: HandoffStore,
  params: { tenantId: string; conversationId: string; adminId: string | null; automatic?: boolean; log: WhatsAppLogger; now?: number },
): Promise<void> {
  const at = iso(params.now ?? Date.now());
  const resolution = params.automatic ? 'auto_resumed' : 'resumed';
  const resolved = await store.resolveOpenHandoffs(params.tenantId, params.conversationId, resolution, params.adminId, at);
  await store.updateConversation(params.tenantId, params.conversationId, {
    status: 'open', automation_status: 'active', automation_resume_at: null, assigned_to: null,
  });
  await store.audit({
    tenantId: params.tenantId, conversationId: params.conversationId,
    eventType: params.automatic ? 'automation_auto_resumed' : 'automation_resumed',
    actorType: params.automatic ? 'system' : 'admin', actorAdminId: params.adminId, detail: { handoffs_resolved: resolved },
  });
  params.log('handoff_resolved', { tenantId: params.tenantId, conversationId: params.conversationId, resolution });
}

export async function closeConversation(
  store: HandoffStore,
  params: { tenantId: string; conversationId: string; adminId: string; now?: number },
): Promise<void> {
  const at = iso(params.now ?? Date.now());
  await store.resolveOpenHandoffs(params.tenantId, params.conversationId, 'closed', params.adminId, at);
  // Fermée = traitée. Un nouveau message client la rouvre avec l'automatisation active.
  await store.updateConversation(params.tenantId, params.conversationId, {
    status: 'closed', automation_status: 'active', automation_resume_at: null, unread_count: 0,
  });
  await store.audit({
    tenantId: params.tenantId, conversationId: params.conversationId, eventType: 'conversation_closed',
    actorType: 'admin', actorAdminId: params.adminId, detail: {},
  });
}
