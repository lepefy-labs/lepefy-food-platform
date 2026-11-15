/**
 * Growth prospecting (platform owner only). A dossier is produced and validated
 * by the growth CLI (growth/), re-validated on import by the same engine
 * (lib/growth/engine), and worked from /admin/platform/prospection.
 */

export type GrowthStatus = 'pronta' | 'da_coltivare' | 'non_qualificata' | 'respinta';
export type EntryKind = 'introduction' | 'visit' | 'event' | 'inbound' | 'written_channel' | 'none';
export type SignalState = 'confirmed' | 'indicated' | 'contested' | 'unknown';

export interface GrowthEvidence {
  id: string;
  url: string;
  checkedAt: string;
  access: 'opened' | 'blocked' | 'search_only';
  kind: string;
  supports?: string[];
  refutes?: string[];
  note: string;
}

export interface GrowthClaim { text: string; evidence?: string[]; feature?: string }

export interface GrowthMessage { language: string; channel: string; text: string; claims: GrowthClaim[] }

export interface GrowthDossier {
  name: string;
  aliases?: string[];
  city: string;
  region?: string;
  country: string;
  segment: string;
  address?: string;
  vat?: string;
  email?: string;
  links?: { website?: string; facebook?: string; instagram?: string; whatsapp?: string; other?: string[] };
  phones?: string[];
  evidence: GrowthEvidence[];
  signals?: Record<string, string>;
  verifiedFact: { text: string; evidence: string[] };
  hypothesis: { problem: string; question: string };
  lepefy: { featureIds: string[]; demoFlow: string };
  entry: { kind: EntryKind; detail?: string; evidence?: string[]; nextAction: string; invitesBusinessContact?: boolean; intermediary?: string; date?: string };
  message: GrowthMessage;
  priority: { level: 'A' | 'B' | 'C'; reason: string };
  confidence: 'alta' | 'media' | 'bassa';
  toVerify: string[];
  ecommerceNeed?: { text: string; evidence: string[] };
}

export interface GrowthEvaluation {
  errors: string[];
  warnings: string[];
  signals: Record<string, SignalState>;
  fit: { score: number; breakdown: { signal: string; state: string; points: number }[]; qualified: boolean; notes: string[] };
  entry: { kind: EntryKind; verified: boolean; reasons: string[] };
  status: GrowthStatus;
  separate: boolean;
  confidence: string;
  contested: string[];
}

/** Where the shop is in the conversation with Lepefy (set by the recorded contacts). */
export const SALES_STAGES = ['da_contattare', 'contattato', 'in_conversazione', 'demo', 'cliente', 'perso'] as const;
export type SalesStage = typeof SALES_STAGES[number];

/** Same list as growth/src/store.mjs OUTCOME_TYPES (parity-tested). */
export const TOUCH_OUTCOMES = ['contattato', 'introduzione', 'risposta', 'demo', 'rifiuto', 'nessuna_risposta', 'tenant_pagante'] as const;
export type TouchOutcome = typeof TOUCH_OUTCOMES[number];

export const TOUCH_CHANNELS = ['visita', 'telefono', 'whatsapp', 'email', 'instagram', 'modulo', 'presentazione', 'altro'] as const;
export type TouchChannel = typeof TOUCH_CHANNELS[number];

export interface GrowthProspectRow {
  id: string;
  name: string;
  city: string;
  country: string;
  segment: string;
  status: GrowthStatus;
  separate_segment: boolean;
  fit_score: number;
  priority: 'A' | 'B' | 'C' | null;
  entry_kind: EntryKind;
  entry_verified: boolean;
  dossier: GrowthDossier;
  evaluation: GrowthEvaluation;
  identity_keys: string[];
  runs: string[];
  first_seen: string;
  last_seen: string;
  sales_stage: SalesStage;
  next_action_at: string | null;
  last_contact_at: string | null;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  message_draft: string | null;
  updated_at: string;
}

export interface GrowthTouchRow {
  id: string;
  prospect_id: string;
  occurred_at: string;
  channel: TouchChannel;
  outcome: TouchOutcome;
  reason: string | null;
  note: string | null;
  message_text: string | null;
}
