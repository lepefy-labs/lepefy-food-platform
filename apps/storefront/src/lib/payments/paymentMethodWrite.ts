import {
  PAYMENT_METHOD_REGISTRY,
  isPaymentMethodType,
  isPaymentModule,
  type PaymentMethodType,
  type PaymentModule,
  type TenantPaymentMethod,
} from '@lepefy/types';

/**
 * Server-side validation of POST/PATCH /api/admin/payment-methods. Same rules
 * as the admin editor (paymentMethodForm.ts) and the DB constraints (method
 * list, non-empty enabled_modules ⊆ modules), read from PAYMENT_METHOD_REGISTRY.
 * Pure; tested in tests/unit/paymentMethodWrite.spec.ts.
 */

export type PaymentMethodRow = Pick<TenantPaymentMethod, 'method' | 'label' | 'value' | 'extra' | 'sort_order' | 'active' | 'enabled_modules'>;

export type WriteResult<T> = { ok: true; values: T } | { ok: false; status: 400 | 409; error: string };

const EXTRA_KEYS = ['link', 'beneficiary', 'bic'] as const;
const MAX_LABEL = 60;
const MAX_TEXT = 500;

function text(raw: unknown, max = MAX_TEXT): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().slice(0, max);
  return s === '' ? null : s;
}

function cleanExtra(raw: unknown): TenantPaymentMethod['extra'] {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const key of EXTRA_KEYS) {
    const value = text((raw as Record<string, unknown>)[key]);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function modules(raw: unknown): PaymentModule[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isPaymentModule)) return null;
  return [...new Set(raw)];
}

function checkLink(extra: TenantPaymentMethod['extra']): string | null {
  const link = extra?.link;
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' ? null : 'Le lien de paiement doit commencer par https://.';
  } catch {
    return 'Le lien de paiement n’est pas une adresse valide.';
  }
}

const MODULES_ERROR = 'Choisissez au moins un service parmi Boutique, /card, Événements et Location.';

/** POST: full row. `existingTypes` = types the tenant already has (single-instance rule). */
export function parseCreate(body: Record<string, unknown>, existingTypes: ReadonlyArray<PaymentMethodType>): WriteResult<PaymentMethodRow> {
  if (!isPaymentMethodType(body.method)) return { ok: false, status: 400, error: 'Type de moyen de paiement inconnu.' };
  const method = body.method;
  const meta = PAYMENT_METHOD_REGISTRY[method];
  if (meta.singleInstance && existingTypes.includes(method)) {
    return { ok: false, status: 409, error: `${meta.label} est déjà configuré : modifiez le moyen existant.` };
  }
  let enabledModules: PaymentModule[] = [...meta.defaultModules];
  if ('enabled_modules' in body) {
    const parsed = modules(body.enabled_modules);
    if (!parsed) return { ok: false, status: 400, error: MODULES_ERROR };
    enabledModules = parsed;
  }
  const extra = meta.storesDetails ? cleanExtra(body.extra) : null;
  const linkError = checkLink(extra);
  if (linkError) return { ok: false, status: 400, error: linkError };
  return {
    ok: true,
    values: {
      method,
      label: text(body.label, MAX_LABEL),
      value: meta.storesDetails ? text(body.value) : null,
      extra,
      sort_order: Number.parseInt(String(body.sort_order ?? 0), 10) || 0,
      active: Boolean(body.active),
      enabled_modules: enabledModules,
    },
  };
}

/** PATCH: only the fields present. The type of an existing row never changes. */
export function parseUpdate(body: Record<string, unknown>, existing: Pick<TenantPaymentMethod, 'method'>): WriteResult<Partial<PaymentMethodRow>> {
  if ('method' in body && body.method !== existing.method) {
    return { ok: false, status: 409, error: 'Le type d’un moyen de paiement ne change pas : ajoutez un nouveau moyen.' };
  }
  const meta = PAYMENT_METHOD_REGISTRY[existing.method];
  const values: Partial<PaymentMethodRow> = {};
  if ('label' in body) values.label = text(body.label, MAX_LABEL);
  if ('value' in body) values.value = meta.storesDetails ? text(body.value) : null;
  if ('extra' in body) {
    values.extra = meta.storesDetails ? cleanExtra(body.extra) : null;
    const linkError = checkLink(values.extra);
    if (linkError) return { ok: false, status: 400, error: linkError };
  }
  if ('sort_order' in body) values.sort_order = Number.parseInt(String(body.sort_order), 10) || 0;
  if ('active' in body) values.active = Boolean(body.active);
  if ('enabled_modules' in body) {
    const parsed = modules(body.enabled_modules);
    if (!parsed) return { ok: false, status: 400, error: MODULES_ERROR };
    values.enabled_modules = parsed;
  }
  return { ok: true, values };
}
