import type {
  SupportCategory, SupportLinkKind, SupportPriority, SupportResourceType, SupportSourceChannel, SupportStatus, SupportTenantStatus,
} from './domain';
import type { SupportContext } from './rules';

/** Shop projection (RPC support_tenant_thread): never notes, links, priority or assignee. */
export interface TenantThreadAttachment { id: string; mime_type: string; width: number | null; height: number | null }

export interface TenantThreadMessage {
  id: string;
  author_type: 'tenant' | 'lepefy';
  /** Name of a shop colleague; null for Lepefy (« Équipe Lepefy »). */
  author_label: string | null;
  mine: boolean;
  body: string;
  relayed_from: Exclude<SupportSourceChannel, 'app'> | null;
  original_sent_at: string | null;
  created_at: string;
  attachments: TenantThreadAttachment[];
}

export interface TenantThreadEvent {
  id: string;
  event_type: string;
  created_at: string;
  to_tenant_status: SupportTenantStatus | null;
  value: string | null;
}

export interface TenantThread {
  ticket: {
    id: string;
    number: number;
    title: string;
    category: SupportCategory;
    tenant_status: SupportTenantStatus;
    /** 'resolved' while Lepefy waits for « Est-ce que le problème est résolu ? ». */
    status_detail: 'resolved' | null;
    source_channel: SupportSourceChannel;
    origin: 'tenant_app' | 'platform_manual';
    created_at: string;
    reported_at: string;
    last_activity_at: string;
    page_label: string | null;
    resource_label: string | null;
    tenant_feedback: 'solved' | 'not_solved' | null;
    merged_into_number: number | null;
    last_read_at: string | null;
  };
  messages: TenantThreadMessage[];
  events: TenantThreadEvent[];
}

export interface TenantTicketRow {
  id: string;
  number: number;
  title: string;
  category: SupportCategory;
  tenant_status: SupportTenantStatus;
  created_at: string;
  last_activity_at: string;
  unread: boolean;
  last_message_author: 'tenant' | 'lepefy' | null;
  last_message_excerpt: string | null;
  merged_into_number: number | null;
}

/** Platform console: full ticket. */
export interface PlatformTicket {
  id: string;
  number: number;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  origin: 'tenant_app' | 'platform_manual';
  source_channel: SupportSourceChannel;
  external_reference: string | null;
  requester_admin_id: string | null;
  requester_label: string | null;
  created_by_admin_id: string | null;
  title: string;
  summary: string;
  category: SupportCategory;
  status: SupportStatus;
  priority: SupportPriority;
  declared_urgent: boolean;
  assignee_admin_id: string | null;
  visible_to_tenant: boolean;
  context: SupportContext;
  resource_type: SupportResourceType | null;
  resource_id: string | null;
  resource_label: string | null;
  merged_into_ticket_id: string | null;
  tenant_feedback: 'solved' | 'not_solved' | null;
  tenant_feedback_at: string | null;
  reported_at: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  last_tenant_message_at: string | null;
  last_staff_reply_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  reopen_count: number;
  awaiting_lepefy: boolean;
  stale: boolean;
  attention_rank: number;
}

export interface PlatformMessage {
  id: string;
  author_type: 'tenant' | 'lepefy';
  author_admin_id: string | null;
  author_label: string | null;
  kind: 'message' | 'internal_note';
  body: string;
  relayed_from: Exclude<SupportSourceChannel, 'app'> | null;
  original_sent_at: string | null;
  created_at: string;
  attachments: Array<TenantThreadAttachment & { internal: boolean }>;
}

export interface PlatformEvent {
  id: string;
  event_type: string;
  actor_type: 'tenant' | 'lepefy' | 'system';
  actor_admin_id: string | null;
  from_value: string | null;
  to_value: string | null;
  public: boolean;
  created_at: string;
}

export interface PlatformLink { id: string; kind: SupportLinkKind; url: string; label: string | null; created_at: string }

export interface PlatformTicketDetail {
  ticket: PlatformTicket;
  messages: PlatformMessage[];
  events: PlatformEvent[];
  links: PlatformLink[];
  mergedInto: { id: string; number: number } | null;
  mergedFrom: Array<{ id: string; number: number }>;
  people: Record<string, string>;
  lastReadAt: string | null;
}
