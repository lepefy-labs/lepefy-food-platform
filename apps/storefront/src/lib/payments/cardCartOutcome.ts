/**
 * Paniers payés par carte et non finalisés : ce qui s'est passé, en français
 * simple, à partir de deux sources indépendantes.
 *
 *   1. le journal `payment_funnel_logs` de la session (évènements du
 *      formulaire carte côté navigateur + refus Stripe enregistrés par le
 *      webhook, `payment_failed_server`) → `classifyCardCart`, utilisé par la
 *      liste « Paniers à relancer » et la fiche ;
 *   2. la lecture en direct du PaymentIntent Stripe (fiche admin, à la
 *      demande) → `describeStripeIntent`.
 *
 * Jamais de numéro de carte, de nom du titulaire ni de clé : seulement statut,
 * codes de refus, réseau et 4 derniers chiffres. Pur et testé.
 */

export type CardCartOutcome =
  | 'declined'
  | 'authentication_pending'
  | 'error'
  | 'left_after_pay'
  | 'left_form'
  | 'not_started'
  | 'succeeded';

export interface CardCartOutcomeMeta {
  label: string;
  tone: 'danger' | 'warning' | 'info' | 'neutral' | 'success';
}

export const CARD_CART_OUTCOME_META: Record<CardCartOutcome, CardCartOutcomeMeta> = {
  declined: { label: 'Carte refusée', tone: 'danger' },
  authentication_pending: { label: '3-D Secure non terminé', tone: 'warning' },
  error: { label: 'Erreur de paiement', tone: 'warning' },
  left_after_pay: { label: 'Page quittée après « Payer »', tone: 'warning' },
  left_form: { label: 'Carte non saisie', tone: 'neutral' },
  not_started: { label: 'Paiement non commencé', tone: 'neutral' },
  succeeded: { label: 'Paiement validé', tone: 'success' },
};

export interface FunnelEvent {
  event_type: string;
  created_at: string;
  detail?: Record<string, unknown> | null;
}

/** Résumé d'un panier carte à partir de son journal (le plus parlant gagne). */
export function classifyCardCart(events: readonly FunnelEvent[]): CardCartOutcome {
  const types = new Set(events.map((event) => event.event_type));
  if (types.has('confirm_succeeded_client')) return 'succeeded';
  const failures = events.filter((event) => event.event_type === 'payment_failed_server');
  if (failures.some((event) => !isAuthenticationFailure(stringOrNull(event.detail?.code), stringOrNull(event.detail?.decline_code)))) return 'declined';
  if (failures.length > 0 || types.has('requires_action')) return 'authentication_pending';
  if (types.has('confirm_error')) return 'error';
  // Paiement différé : le PaymentIntent n'est créé qu'au clic sur « Payer ».
  if (types.has('confirm_attempted') || types.has('intent_created')) return 'left_after_pay';
  if (types.has('abandoned_payment_form') || types.has('elements_mounted')) return 'left_form';
  return 'not_started';
}

/** Ligne du parcours client affichée dans la fiche (null = évènement non montré). */
export function journeyLabel(event: FunnelEvent): string | null {
  switch (event.event_type) {
    case 'checkout_started': return 'Passage au paiement';
    case 'elements_mounted': return 'Formulaire carte affiché';
    case 'confirm_attempted': return '« Payer » cliqué';
    case 'intent_created': return 'Paiement créé chez Stripe';
    case 'requires_action': return 'Vérification 3-D Secure demandée par la banque';
    case 'confirm_error': return `Erreur au paiement${declineSuffix(event.detail)}`;
    case 'payment_failed_server':
      return isAuthenticationFailure(stringOrNull(event.detail?.code), stringOrNull(event.detail?.decline_code))
        ? 'Vérification 3-D Secure non aboutie'
        : `Paiement refusé${declineSuffix(event.detail)}`;
    case 'confirm_succeeded_client': return 'Paiement validé par la carte';
    case 'abandoned_payment_form': return 'Page quittée sans résultat';
    case 'checkout_resumed': return 'Achat repris par le client';
    case 'checkout_expired': return 'Session expirée';
    case 'checkout_cancelled': return 'Session annulée';
    case 'checkout_reused': {
      const kind = event.detail?.kind;
      if (kind === 'payment_reminder_sent') return 'Rappel envoyé au client';
      if (kind === 'payment_reminder_failed') return 'Rappel non transmis';
      return null;
    }
    default: return null;
  }
}

function declineSuffix(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return '';
  const reason = declineReason(stringOrNull(detail.decline_code), stringOrNull(detail.code));
  return reason ? ` : ${reason.toLowerCase()}` : '';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

const DECLINE_REASONS: Record<string, string> = {
  insufficient_funds: 'Fonds insuffisants',
  expired_card: 'Carte expirée',
  incorrect_cvc: 'Code de sécurité incorrect',
  invalid_cvc: 'Code de sécurité incorrect',
  incorrect_number: 'Numéro de carte incorrect',
  invalid_number: 'Numéro de carte incorrect',
  invalid_expiry_month: 'Date d’expiration incorrecte',
  invalid_expiry_year: 'Date d’expiration incorrecte',
  card_velocity_exceeded: 'Plafond de la carte atteint',
  withdrawal_count_limit_exceeded: 'Plafond de la carte atteint',
  lost_card: 'Carte déclarée perdue',
  stolen_card: 'Carte déclarée volée',
  pickup_card: 'Carte bloquée par la banque',
  restricted_card: 'Carte bloquée par la banque',
  fraudulent: 'Paiement bloqué (suspicion de fraude)',
  merchant_blacklist: 'Paiement bloqué (suspicion de fraude)',
  do_not_honor: 'Refusé par la banque',
  generic_decline: 'Refusé par la banque',
  call_issuer: 'Refusé par la banque',
  transaction_not_allowed: 'Opération non autorisée sur cette carte',
  card_not_supported: 'Carte non acceptée',
  currency_not_supported: 'Devise non acceptée par la carte',
  authentication_required: 'Vérification 3-D Secure requise',
  payment_intent_authentication_failure: 'Vérification 3-D Secure abandonnée ou échouée',
  authentication_not_handled: 'Vérification 3-D Secure non effectuée',
  payment_intent_payment_attempt_failed: 'Tentative de paiement échouée',
  payment_intent_payment_attempt_expired: 'Tentative de paiement expirée',
  payment_method_provider_decline: 'Refusé par la banque',
  processing_error: 'Erreur technique de la banque',
  issuer_not_available: 'Banque injoignable, à réessayer',
  try_again_later: 'Banque injoignable, à réessayer',
  reenter_transaction: 'À réessayer',
  card_decline_rate_limit_exceeded: 'Trop de tentatives sur cette carte',
  incorrect_zip: 'Code postal de la carte incorrect',
  incorrect_pin: 'Code PIN incorrect',
  pin_try_exceeded: 'Trop d’essais de code PIN',
  not_permitted: 'Opération non autorisée sur cette carte',
  service_not_allowed: 'Opération non autorisée sur cette carte',
  security_violation: 'Refusé par la banque (sécurité)',
  invalid_account: 'Compte de la carte invalide',
  new_account_information_available: 'Carte remplacée par la banque',
  testmode_decline: 'Carte de test refusée',
  card_declined: 'Refusé par la banque',
};

const AUTHENTICATION_CODES = new Set(['payment_intent_authentication_failure', 'authentication_not_handled', 'authentication_required']);

/** Échec de la vérification 3-D Secure (le paiement n'a pas atteint l'autorisation bancaire). */
export function isAuthenticationFailure(code: string | null, declineCode: string | null): boolean {
  return Boolean((code && AUTHENTICATION_CODES.has(code)) || (declineCode && AUTHENTICATION_CODES.has(declineCode)));
}

/** Motif lisible d'un refus (code Stripe ou code de la banque) ; null si inconnu. */
export function declineReason(declineCode: string | null, code: string | null): string | null {
  return (declineCode && DECLINE_REASONS[declineCode]) || (code && DECLINE_REASONS[code]) || null;
}

/** Sous-ensemble du PaymentIntent Stripe utilisé (indépendant du SDK, testable). */
export interface StripeIntentLike {
  id: string;
  status: string;
  amount: number;
  currency: string;
  created: number;
  canceled_at?: number | null;
  cancellation_reason?: string | null;
  last_payment_error?: {
    code?: string | null;
    decline_code?: string | null;
    type?: string | null;
    payment_method?: { card?: StripeCardLike | null } | string | null;
  } | null;
  latest_charge?: StripeChargeLike | string | null;
}

export interface StripeChargeLike {
  status: string;
  created: number;
  failure_code?: string | null;
  outcome?: { reason?: string | null; seller_message?: string | null } | null;
  payment_method_details?: { type?: string | null; card?: StripeCardLike | null } | null;
}

export interface StripeCardLike {
  brand?: string | null;
  last4?: string | null;
}

export interface StripeIntentView {
  statusLabel: string;
  tone: CardCartOutcomeMeta['tone'];
  explanation: string;
  rawStatus: string;
  amount: number;
  currency: string;
  createdAt: string;
  /** `at` null : tentative sans transaction (Stripe ne date que les transactions). */
  lastAttempt: { at: string | null; result: string; reason: string | null } | null;
  card: string | null;
  charged: boolean;
  /** Code Stripe brut du dernier échec (`decline_code`, sinon `code`), affiché tel quel. */
  errorCode: string | null;
}

const BRANDS: Record<string, string> = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', cartes_bancaires: 'CB', discover: 'Discover', unionpay: 'UnionPay', jcb: 'JCB',
};

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Lecture en français d'un PaymentIntent pour la fiche admin. */
export function describeStripeIntent(intent: StripeIntentLike): StripeIntentView {
  const charge = typeof intent.latest_charge === 'object' && intent.latest_charge ? intent.latest_charge : null;
  const error = intent.last_payment_error ?? null;
  const reason = declineReason(error?.decline_code ?? null, error?.code ?? null)
    ?? declineReason(charge?.outcome?.reason ?? null, charge?.failure_code ?? null);
  const errorCard = typeof error?.payment_method === 'object' && error.payment_method ? error.payment_method.card : null;
  const card = charge?.payment_method_details?.card ?? errorCard;
  const cardLabel = card?.last4 ? `${BRANDS[card.brand ?? ''] ?? card.brand ?? 'Carte'} ·· ${card.last4}` : null;
  // Échec sans transaction : refus avant la banque (3-D Secure, carte invalide…).
  const failedBeforeBank = Boolean(error) && charge?.status !== 'failed';
  const authentication = isAuthenticationFailure(error?.code ?? null, error?.decline_code ?? null);
  const base = {
    rawStatus: intent.status,
    amount: intent.amount / 100,
    currency: intent.currency.toUpperCase(),
    createdAt: iso(intent.created),
    card: cardLabel,
    charged: intent.status === 'succeeded' || charge?.status === 'succeeded',
    errorCode: error?.decline_code || error?.code || charge?.outcome?.reason || charge?.failure_code || null,
    lastAttempt: charge ? {
      at: iso(charge.created),
      result: charge.status === 'succeeded' ? 'Accepté' : charge.status === 'failed' ? 'Refusé' : 'En attente',
      reason: charge.status === 'failed' ? reason : null,
    } : error ? { at: null, result: 'Non aboutie', reason } : null,
  };

  switch (intent.status) {
    case 'succeeded':
      return { ...base, statusLabel: 'Payé', tone: 'success', explanation: 'Stripe a encaissé ce paiement. Si aucune commande n’existe, contactez le support : la confirmation automatique n’a pas abouti.' };
    case 'processing':
      return { ...base, statusLabel: 'Paiement en cours', tone: 'info', explanation: 'La banque traite encore le paiement. Le statut changera tout seul.' };
    case 'requires_action':
      return { ...base, statusLabel: 'Vérification bancaire non terminée', tone: 'warning', explanation: 'Le client a été envoyé vers sa banque (3-D Secure) et n’a pas terminé. Aucun montant n’a été débité.' };
    case 'requires_capture':
      return { ...base, statusLabel: 'Autorisé, non encaissé', tone: 'info', explanation: 'Le montant est réservé sur la carte mais pas encore encaissé.' };
    case 'canceled':
      return { ...base, statusLabel: 'Annulé', tone: 'neutral', explanation: 'Ce paiement a été annulé chez Stripe. Aucun montant n’a été débité.' };
    default: {
      // requires_payment_method / requires_confirmation
      if (failedBeforeBank && authentication) {
        return { ...base, statusLabel: 'Paiement non abouti', tone: 'warning', explanation: 'La vérification 3-D Secure n’a pas abouti : le client l’a fermée ou sa banque ne l’a pas validée. Le paiement n’a pas atteint la banque, aucun montant n’a été débité ; le client peut réessayer.' };
      }
      if (failedBeforeBank) {
        return { ...base, statusLabel: 'Paiement non abouti', tone: 'warning', explanation: `${reason ? `${reason}. ` : ''}Le paiement n’a pas atteint la banque (vérification 3-D Secure abandonnée, carte invalide ou erreur). Aucun montant n’a été débité ; le client peut réessayer.` };
      }
      if (charge?.status === 'failed') {
        return { ...base, statusLabel: 'Paiement refusé', tone: 'danger', explanation: `${reason ? `${reason}. ` : 'La banque a refusé le paiement. '}Aucun montant n’a été débité ; le client peut réessayer avec une autre carte ou un autre moyen.` };
      }
      return { ...base, statusLabel: 'Carte jamais validée', tone: 'neutral', explanation: 'Le client n’a pas validé de carte pour ce paiement. Aucun montant n’a été débité.' };
    }
  }
}

/** Lien vers le paiement dans le tableau de bord Stripe (mode test si clé de test). */
export function stripeDashboardUrl(paymentIntentId: string, testMode: boolean): string {
  return `https://dashboard.stripe.com/${testMode ? 'test/' : ''}payments/${encodeURIComponent(paymentIntentId)}`;
}

/** Détail enregistré pour un refus Stripe (webhook) : codes seulement, jamais de donnée carte. */
export function paymentFailureDetail(input: {
  eventId: string;
  paymentIntentId: string;
  lastPaymentError?: { code?: string | null; decline_code?: string | null; type?: string | null; payment_method?: { type?: string | null } | null } | null;
}): Record<string, string | null> {
  const error = input.lastPaymentError ?? null;
  return {
    stripe_event_id: input.eventId,
    payment_intent_id: input.paymentIntentId,
    code: error?.code ?? null,
    decline_code: error?.decline_code ?? null,
    error_type: error?.type ?? null,
    payment_method_type: error?.payment_method?.type ?? null,
  };
}
