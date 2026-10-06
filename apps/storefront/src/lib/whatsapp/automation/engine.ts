import type { WhatsAppChannelStatus, WhatsAppHandoffReason } from '@/lib/whatsapp/types';
import type { IntentDetection } from './intents';
import type { ResolvedRule, RuleCode } from './rules';

/**
 * Décision d'automatisation — fonction pure, sans I/O (testée unitairement).
 *
 *   message entrant
 *     -> canal actif ? automatisation activée ? tenant non suspendu ?
 *     -> conversation en pause (opérateur) ?  => aucune réponse
 *     -> intention sensible (opérateur, réclamation, paiement, non reçu) => handoff
 *     -> règle déterministe (priorité tenant)  => réponse à partir des données Lepefy
 *     -> Nala (si activée)                     => garde-fous => réponse ou handoff
 *     -> sinon handoff (ou repli si le handoff est désactivé)
 *
 * Les réponses déterministes priment toujours sur l'IA quand des données
 * structurées existent ; l'IA ne traite jamais paiement, commande ou livraison.
 */

export interface EngineInput {
  channel: { status: WhatsAppChannelStatus; automation_enabled: boolean; human_handoff_enabled: boolean };
  conversation: { automation_status: 'active' | 'paused'; isNew: boolean };
  message: { type: string; text: string | null };
  rules: ResolvedRule[];
  detection: IntentDetection;
  /** Sujet « boutique » reconnu par le Fast Resolver Nala avec une donnée tenant disponible. */
  storeInfo: 'opening_hours' | 'location' | null;
  tenantSuspended: boolean;
  /** ai_enabled sur le canal ET droit Nala du tenant. */
  nalaAvailable: boolean;
}

export type SkipReason =
  | 'channel_not_active' | 'automation_disabled' | 'tenant_suspended' | 'automation_paused' | 'reaction';

export type FallbackReason = 'handoff_disabled' | 'no_answer';

export type EngineDecision =
  | { action: 'skip'; reason: SkipReason }
  | { action: 'handoff'; reason: WhatsAppHandoffReason; greeting: boolean }
  | { action: 'rule'; code: RuleCode; greeting: boolean }
  | { action: 'nala'; greeting: boolean }
  | { action: 'fallback'; reason: FallbackReason; greeting: boolean };

const HANDOFF_INTENTS: Array<[IntentDetection['intents'][number], WhatsAppHandoffReason]> = [
  ['human_request', 'customer_request'],
  ['payment_issue', 'payment_issue'],
  ['order_not_received', 'order_not_received'],
  ['complaint', 'complaint'],
];

const INTENT_RULES: Partial<Record<IntentDetection['intents'][number], RuleCode>> = {
  order_status: 'order_status',
  tracking: 'tracking',
  shipping: 'shipping',
  catalog: 'catalog',
  product_availability: 'product_availability',
};

function enabledRule(rules: ResolvedRule[], code: RuleCode): ResolvedRule | null {
  return rules.find((rule) => rule.code === code && rule.enabled) ?? null;
}

export function isHandoffAvailable(input: Pick<EngineInput, 'channel' | 'rules'>): boolean {
  return input.channel.human_handoff_enabled && Boolean(enabledRule(input.rules, 'human_handoff'));
}

export function decideAutomation(input: EngineInput): EngineDecision {
  if (input.channel.status !== 'active') return { action: 'skip', reason: 'channel_not_active' };
  if (!input.channel.automation_enabled) return { action: 'skip', reason: 'automation_disabled' };
  if (input.tenantSuspended) return { action: 'skip', reason: 'tenant_suspended' };
  if (input.conversation.automation_status === 'paused') return { action: 'skip', reason: 'automation_paused' };
  if (input.message.type === 'reaction') return { action: 'skip', reason: 'reaction' };

  const handoff = isHandoffAvailable(input);
  const greetingRule = enabledRule(input.rules, 'greeting');
  const greeting = input.conversation.isNew && Boolean(greetingRule);
  const text = input.message.text?.trim() ?? '';

  // Média, position, contact sans texte : un humain doit regarder.
  if (!text) {
    return handoff
      ? { action: 'handoff', reason: 'media_message', greeting }
      : { action: 'fallback', reason: 'handoff_disabled', greeting };
  }

  const sensitive = HANDOFF_INTENTS.find(([intent]) => input.detection.intents.includes(intent));
  if (sensitive) {
    return handoff
      ? { action: 'handoff', reason: sensitive[1], greeting }
      : { action: 'fallback', reason: 'handoff_disabled', greeting };
  }

  const candidates: RuleCode[] = [];
  for (const intent of input.detection.intents) {
    const code = INTENT_RULES[intent];
    if (code) candidates.push(code);
  }
  if (input.storeInfo) candidates.push(input.storeInfo);
  const rule = input.rules.find((candidate) => candidate.enabled && candidates.includes(candidate.code));
  if (rule) return { action: 'rule', code: rule.code, greeting };

  if (input.detection.greetingOnly) {
    if (greetingRule) return { action: 'rule', code: 'greeting', greeting: false };
    if (input.nalaAvailable) return { action: 'nala', greeting: false };
    return { action: 'fallback', reason: 'no_answer', greeting: false };
  }

  if (input.nalaAvailable) return { action: 'nala', greeting };
  if (handoff) return { action: 'handoff', reason: 'unsupported_intent', greeting };
  return { action: 'fallback', reason: 'handoff_disabled', greeting };
}

/** Seuil sous lequel une réponse Nala n'est pas envoyée (auto-évaluation non calibrée : signal faible, prudent). */
export const NALA_MIN_CONFIDENCE = 0.55;

export type NalaGuardrailDecision =
  | { kind: 'accept' }
  | { kind: 'rule'; code: RuleCode }
  | { kind: 'handoff'; reason: WhatsAppHandoffReason }
  | { kind: 'fallback' };

/**
 * Garde-fous après Nala : les sujets transactionnels (paiement, commande,
 * livraison) repartent vers une règle déterministe ou un opérateur ; une
 * confiance faible ou une intention inconnue part vers un opérateur.
 */
export function evaluateNalaGuardrails(
  result: { intent: string; confidence: number | null },
  context: Pick<EngineInput, 'channel' | 'rules'>,
): NalaGuardrailDecision {
  const handoff = isHandoffAvailable(context);
  const escalate = (reason: WhatsAppHandoffReason): NalaGuardrailDecision => handoff ? { kind: 'handoff', reason } : { kind: 'fallback' };

  if (result.intent === 'payment_help') return escalate('payment_issue');
  if (result.intent === 'order_help') {
    return enabledRule(context.rules, 'order_status') ? { kind: 'rule', code: 'order_status' } : escalate('unsupported_intent');
  }
  if (result.intent === 'delivery') {
    return enabledRule(context.rules, 'shipping') ? { kind: 'rule', code: 'shipping' } : escalate('unsupported_intent');
  }
  if (result.intent === 'unknown') return escalate('unsupported_intent');
  if (result.confidence !== null && result.confidence < NALA_MIN_CONFIDENCE) return escalate('low_confidence');
  return { kind: 'accept' };
}
