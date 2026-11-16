import {
  PAYMENT_METHOD_REGISTRY,
  PAYMENT_METHOD_TYPE_KEYS,
  PAYMENT_MODULE_KEYS,
  type PaymentMethodType,
  type PaymentModule,
  type TenantPaymentMethod,
} from '@lepefy/types';

/**
 * Admin editor of `tenant_payment_methods` (Paramètres › Paiements): which
 * fields each type asks for, validation, request body and list order. Pure and
 * client-safe; tested in tests/unit/paymentMethodForm.spec.ts.
 */

export const PAYMENT_MODULES: ReadonlyArray<{ value: PaymentModule; label: string; detail: string }> = [
  { value: 'shop', label: 'Boutique', detail: 'Checkout en ligne et liens de paiement envoyés aux clients' },
  { value: 'card', label: 'Page /card', detail: 'Paiement en magasin par QR code' },
  { value: 'event', label: 'Événements', detail: 'Réservation d’un événement' },
  { value: 'rental', label: 'Location', detail: 'Réservation de matériel' },
];

export const ALL_PAYMENT_MODULES: PaymentModule[] = [...PAYMENT_MODULE_KEYS];

/** Order of the type picker. */
export const PAYMENT_METHOD_TYPES: PaymentMethodType[] = [...PAYMENT_METHOD_TYPE_KEYS];

export const PAYMENT_TYPE_DESCRIPTIONS: Record<PaymentMethodType, string> = {
  card: 'Visa, Mastercard : montant saisi par le client sur /card.',
  apple_pay: 'Bouton Apple Pay sur /card, appareils compatibles.',
  paypal: 'Lien paypal.me, montant prérempli quand c’est possible.',
  satispay: 'Lien de paiement Satispay.',
  bank_transfer: 'IBAN affiché au client, paiement vérifié à la main.',
  cash: 'Paiement en main propre.',
  other: 'Revolut ou tout service avec un lien de paiement.',
};

/** One row per shop: a second one would only duplicate the same /card button. */
export const SINGLE_INSTANCE_TYPES: ReadonlySet<PaymentMethodType> = new Set(
  PAYMENT_METHOD_TYPE_KEYS.filter((t) => PAYMENT_METHOD_REGISTRY[t].singleInstance),
);

export type PaymentMethodField = 'link' | 'value' | 'beneficiary' | 'bic';

interface FieldSpec { label: string; placeholder?: string; hint?: string; optional: boolean; inputMode?: 'url' | 'email' | 'text' }

/** Fields after « Nom affiché », per type. Types without fields only have a name. */
export const PAYMENT_TYPE_FIELDS: Record<PaymentMethodType, Partial<Record<PaymentMethodField, FieldSpec>>> = {
  card: {},
  apple_pay: {},
  cash: {},
  paypal: {
    link: { label: 'Lien PayPal.me', placeholder: 'https://paypal.me/votreboutique', hint: 'Nécessaire pour la boutique, les événements et la location. Le montant est ajouté automatiquement.', optional: true, inputMode: 'url' },
    value: { label: 'Adresse PayPal', placeholder: 'paiements@votreboutique.fr', hint: 'Affichée au client en secours.', optional: true, inputMode: 'email' },
  },
  satispay: {
    link: { label: 'Lien de paiement Satispay', placeholder: 'https://…', optional: true, inputMode: 'url' },
    value: { label: 'Identifiant Satispay', optional: true },
  },
  other: {
    link: { label: 'Lien de paiement', placeholder: 'https://revolut.me/votreboutique', hint: 'Sans lien, ce moyen ne peut être proposé qu’en affichant l’identifiant.', optional: true, inputMode: 'url' },
    value: { label: 'Identifiant ou numéro', optional: true },
  },
  bank_transfer: {
    value: { label: 'IBAN', placeholder: 'FR76 …', optional: false },
    beneficiary: { label: 'Titulaire du compte', optional: false },
    bic: { label: 'BIC', placeholder: 'AGRIFRPP', optional: true },
  },
};

export interface PaymentMethodDraft {
  method: PaymentMethodType;
  label: string;
  value: string;
  link: string;
  beneficiary: string;
  bic: string;
  active: boolean;
  enabled_modules: PaymentModule[];
}

export type PaymentMethodErrors = Partial<Record<'label' | PaymentMethodField | 'enabled_modules', string>>;

export function paymentTypeLabel(method: PaymentMethodType): string {
  return PAYMENT_METHOD_REGISTRY[method]?.label ?? method;
}

export function paymentMethodName(m: Pick<TenantPaymentMethod, 'method' | 'label'>): string {
  return m.label?.trim() || paymentTypeLabel(m.method);
}

export function emptyDraft(method: PaymentMethodType): PaymentMethodDraft {
  return {
    method,
    label: '',
    value: '',
    link: '',
    beneficiary: '',
    bic: '',
    active: true,
    enabled_modules: [...PAYMENT_METHOD_REGISTRY[method].defaultModules],
  };
}

export function draftFromMethod(m: TenantPaymentMethod): PaymentMethodDraft {
  return {
    method: m.method,
    label: m.label ?? '',
    value: m.value ?? '',
    link: m.extra?.link ?? '',
    beneficiary: m.extra?.beneficiary ?? '',
    bic: m.extra?.bic ?? '',
    active: m.active,
    enabled_modules: [...(m.enabled_modules ?? ALL_PAYMENT_MODULES)],
  };
}

function compact(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/** IBAN grouped by 4, as printed on a RIB. */
export function formatIban(iban: string): string {
  return compact(iban).replace(/(.{4})/g, '$1 ').trim();
}

/** ISO 13616 check (country, length range, mod 97). */
export function isValidIban(iban: string): boolean {
  const s = compact(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function isHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function validateDraft(d: PaymentMethodDraft): PaymentMethodErrors {
  const errors: PaymentMethodErrors = {};
  const fields = PAYMENT_TYPE_FIELDS[d.method];
  if (d.method === 'other' && !d.label.trim()) errors.label = 'Donnez un nom : il est affiché au client (ex. Revolut).';
  if (fields.link && d.link.trim()) {
    if (!isHttpsUrl(d.link.trim())) errors.link = 'Le lien doit commencer par https:// (ex. https://paypal.me/votreboutique).';
    else if (d.method === 'paypal' && !/paypal\.(me|com)/i.test(d.link)) errors.link = 'Ce lien ne ressemble pas à un lien PayPal (paypal.me/…).';
  }
  if (d.method === 'bank_transfer') {
    if (!d.value.trim()) errors.value = 'L’IBAN est nécessaire pour un virement.';
    else if (!isValidIban(d.value)) errors.value = 'Cet IBAN n’est pas valide : vérifiez le code pays et les chiffres.';
    if (!d.beneficiary.trim()) errors.beneficiary = 'Indiquez le titulaire du compte.';
  }
  if (d.enabled_modules.length === 0) errors.enabled_modules = 'Choisissez au moins un service.';
  return errors;
}

/** Body of POST/PATCH /api/admin/payment-methods; only the fields the type uses. */
export function draftToBody(d: PaymentMethodDraft) {
  const fields = PAYMENT_TYPE_FIELDS[d.method];
  const extra: Record<string, string> = {};
  if (fields.link) extra.link = d.link.trim();
  if (fields.beneficiary) extra.beneficiary = d.beneficiary.trim();
  if (fields.bic) extra.bic = d.bic.trim().toUpperCase();
  const value = fields.value ? (d.method === 'bank_transfer' ? formatIban(d.value) : d.value.trim()) : '';
  return {
    method: d.method,
    label: d.label.trim() || null,
    value: value || null,
    extra: Object.keys(extra).length ? extra : null,
    active: d.active,
    enabled_modules: ALL_PAYMENT_MODULES.filter((m) => d.enabled_modules.includes(m)),
  };
}

export function draftsEqual(a: PaymentMethodDraft, b: PaymentMethodDraft): boolean {
  return JSON.stringify(draftToBody(a)) === JSON.stringify(draftToBody(b));
}

/** One line under the name in the list. */
export function paymentMethodSummary(m: Pick<TenantPaymentMethod, 'method' | 'value' | 'extra'>): string {
  switch (m.method) {
    case 'card': return 'Montant saisi par le client';
    case 'apple_pay': return 'Affiché sur les appareils compatibles';
    case 'cash': return 'Paiement en main propre';
    case 'bank_transfer': {
      const iban = compact(m.value ?? '');
      const masked = iban ? `${iban.slice(0, 4)} ···· ${iban.slice(-4)}` : 'IBAN manquant';
      return [masked, m.extra?.beneficiary].filter(Boolean).join(' · ');
    }
    default: {
      const link = m.extra?.link?.trim();
      if (link) return link.replace(/^https?:\/\/(www\.)?/, '');
      return m.value?.trim() || 'Lien de paiement manquant';
    }
  }
}

/** Moves the item at `from` to `to` (both clamped); returns a new array. */
export function moveItem<T>(items: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/**
 * Validates a full reorder request against the tenant's rows: every id exactly
 * once, nothing foreign. Returns the rows whose sort_order must change.
 */
export function planReorder(
  current: ReadonlyArray<{ id: string; sort_order: number }>,
  requestedIds: unknown,
): { ok: true; updates: Array<{ id: string; sort_order: number }> } | { ok: false; error: string } {
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== 'string')) {
    return { ok: false, error: 'ids doit être une liste d’identifiants.' };
  }
  const known = new Map(current.map((row) => [row.id, row.sort_order]));
  const unique = new Set(requestedIds as string[]);
  if (unique.size !== requestedIds.length || unique.size !== known.size || [...unique].some((id) => !known.has(id))) {
    return { ok: false, error: 'La liste ne correspond plus aux moyens de paiement enregistrés. Rechargez la page.' };
  }
  const updates = (requestedIds as string[])
    .map((id, index) => ({ id, sort_order: index }))
    .filter(({ id, sort_order }) => known.get(id) !== sort_order);
  return { ok: true, updates };
}
