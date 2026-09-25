'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertTriangle, IconBrandInstagram, IconBrandWhatsapp, IconBuildingStore, IconCash, IconCheck, IconClock,
  IconDots, IconLink, IconLoader2, IconMinus, IconPhone, IconPlus, IconSearch, IconTrash, IconTruck, IconUserPlus, IconX,
} from '@tabler/icons-react';
import type { ManualPaymentMethod, SalesChannel } from '@lepefy/types';
import { MANUAL_PAYMENT_METHOD_LABELS, SALES_CHANNEL_LABELS } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import {
  formatQuantityViolationMessage, getNextValidQuantity, getPreviousValidQuantity, hasPurchasableQuantity,
  validatePurchaseQuantityRules,
} from '@/lib/purchaseQuantityRules';
import { MANUAL_PAYMENT_METHODS, SALES_CHANNELS } from '@/lib/orders/assisted/assistedOrderPolicy';
import type {
  AssistedFormInitial, CustomerOption, ProductOption, QuantityGroupOption, SavedAddress,
} from './types';

type Mode = 'to_pay' | 'to_verify' | 'paid';

interface Line { product: ProductOption; quantity: number }

interface AddressForm { full_name: string; line1: string; line2: string; postal_code: string; city: string; country: string }

interface Quote { key: string; token: string; total: number; details: Record<string, unknown> | null }

const CHANNEL_ICONS: Record<SalesChannel, React.ReactNode> = {
  whatsapp: <IconBrandWhatsapp size={18} />,
  phone: <IconPhone size={18} />,
  instagram: <IconBrandInstagram size={18} />,
  in_store: <IconBuildingStore size={18} />,
  other: <IconDots size={18} />,
};

const MODE_OPTIONS: Array<{ key: Mode; title: string; helper: string; icon: React.ReactNode }> = [
  { key: 'to_pay', title: 'À payer', helper: 'Crée une précommande et un lien de paiement à envoyer au client.', icon: <IconLink size={18} /> },
  { key: 'to_verify', title: 'Paiement à vérifier', helper: 'Le client dit avoir payé (virement, PayPal…) : à contrôler avant confirmation.', icon: <IconClock size={18} /> },
  { key: 'paid', title: 'Déjà payé', helper: 'L’encaissement est déjà reçu : la commande est créée immédiatement.', icon: <IconCash size={18} /> },
];

const inputClass = 'min-h-11 w-full rounded-xl border border-[var(--admin-border)] bg-white px-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 sm:text-sm';
const sectionClass = 'rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5';

function nowLocalInput(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function emptyAddress(country: string, fullName = ''): AddressForm {
  return { full_name: fullName, line1: '', line2: '', postal_code: '', city: '', country };
}

function SectionTitle({ step, title, helper }: { step: number; title: string; helper?: string }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--admin-primary-soft)] text-xs font-bold text-[var(--admin-primary-fg)]">{step}</span>
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {helper && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{helper}</p>}
      </div>
    </div>
  );
}

export default function AssistedOrderForm({
  currency,
  defaultCountry,
  initial,
}: {
  currency: string;
  defaultCountry: string;
  initial?: AssistedFormInitial;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const requestKey = useRef<string>(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '');

  const [salesChannel, setSalesChannel] = useState<SalesChannel | null>(initial?.salesChannel ?? null);

  // ── Client ────────────────────────────────────────────────────────────────
  const [customerId, setCustomerId] = useState<string | null>(initial?.customer.id ?? null);
  const [fullName, setFullName] = useState(initial?.customer.fullName ?? '');
  const [email, setEmail] = useState(initial?.customer.email ?? '');
  const [phone, setPhone] = useState(initial?.customer.phone ?? '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  // ── Produits ──────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<Line[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductOption[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [groups, setGroups] = useState<QuantityGroupOption[] | null>(null);
  const [initialLoading, setInitialLoading] = useState(Boolean(initial?.items.length));

  // ── Remise / livraison ────────────────────────────────────────────────────
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>(initial?.fulfillmentType ?? 'delivery');
  const [selectedAddressId, setSelectedAddressId] = useState<string>('new');
  const [address, setAddress] = useState<AddressForm>(() => initial?.shippingAddress
    ? { ...initial.shippingAddress, line2: initial.shippingAddress.line2 ?? '' }
    : emptyAddress(defaultCountry));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState<string | null>(null);

  // ── Parcours ──────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('to_pay');
  const [declaredMethod, setDeclaredMethod] = useState<ManualPaymentMethod>('bank_transfer');
  const [declaredReference, setDeclaredReference] = useState('');
  const [paidMethod, setPaidMethod] = useState<ManualPaymentMethod>('cash');
  const [paidAt, setPaidAt] = useState(nowLocalInput);
  const [paidReference, setPaidReference] = useState('');
  const [paidNote, setPaidNote] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [adminNote, setAdminNote] = useState(initial?.adminNote ?? '');

  const [submitting, setSubmitting] = useState<null | 'main' | 'draft'>(null);
  const [error, setError] = useState<string | null>(null);

  // Groupes combinables (lecture publique existante, fail-closed pour la validation).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/quantity-groups', { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null) as { groups?: QuantityGroupOption[] } | null;
        if (!cancelled) setGroups(res.ok ? body?.groups ?? [] : null);
      })
      .catch(() => { if (!cancelled) setGroups(null); });
    return () => { cancelled = true; };
  }, []);

  // Mode modification : recharger les produits (prix/stock/règles courants).
  useEffect(() => {
    if (!initial?.items.length) return;
    const ids = initial.items.map((item) => item.productId).join(',');
    fetch(`/api/admin/assisted-orders/products?ids=${encodeURIComponent(ids)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null) as { products?: ProductOption[] } | null;
        const byId = new Map((body?.products ?? []).map((product) => [product.id, product]));
        setLines(initial.items.flatMap((item) => {
          const product = byId.get(item.productId);
          return product ? [{ product, quantity: item.quantity }] : [];
        }));
        if ((body?.products ?? []).length < initial.items.length) {
          setError('Certains articles de cette précommande ne sont plus actifs au catalogue et ont été retirés.');
        }
      })
      .finally(() => setInitialLoading(false));
  }, [initial]);

  // Recherche client (debounce).
  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2) { setCustomerResults([]); return; }
    const timer = window.setTimeout(async () => {
      setCustomerSearching(true);
      try {
        const res = await fetch(`/api/admin/assisted-orders/customers?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null) as { customers?: CustomerOption[] } | null;
        setCustomerResults(body?.customers ?? []);
      } finally {
        setCustomerSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerQuery]);

  // Recherche produit (debounce).
  useEffect(() => {
    const q = productQuery.trim();
    if (q.length < 2) { setProductResults([]); return; }
    const timer = window.setTimeout(async () => {
      setProductSearching(true);
      try {
        const res = await fetch(`/api/admin/assisted-orders/products?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null) as { products?: ProductOption[] } | null;
        setProductResults(body?.products ?? []);
      } finally {
        setProductSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [productQuery]);

  // Adresses enregistrées du client sélectionné.
  useEffect(() => {
    if (!customerId) { setSavedAddresses([]); return; }
    let cancelled = false;
    fetch(`/api/admin/assisted-orders/customers/${customerId}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null) as { addresses?: SavedAddress[] } | null;
        if (!cancelled) setSavedAddresses(body?.addresses ?? []);
      })
      .catch(() => { if (!cancelled) setSavedAddresses([]); });
    return () => { cancelled = true; };
  }, [customerId]);

  const selectCustomer = useCallback((customer: CustomerOption) => {
    setCustomerId(customer.id);
    setFullName(customer.full_name ?? '');
    setEmail(customer.email ?? '');
    setPhone(customer.phone ?? '');
    setCustomerQuery('');
    setCustomerResults([]);
    setNewCustomer(false);
    setAddress((current) => (current.full_name ? current : { ...current, full_name: customer.full_name ?? '' }));
  }, []);

  const clearCustomer = useCallback(() => {
    setCustomerId(null);
    setFullName('');
    setEmail('');
    setPhone('');
    setSelectedAddressId('new');
  }, []);

  // ── Panier ────────────────────────────────────────────────────────────────
  const addProduct = useCallback((product: ProductOption) => {
    setLines((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        const next = getNextValidQuantity(existing.quantity, product.min_order_quantity, product.order_quantity_step, product.stock);
        return next ? current.map((line) => (line.product.id === product.id ? { ...line, quantity: next } : line)) : current;
      }
      if (!hasPurchasableQuantity(product.stock, product.min_order_quantity, product.order_quantity_step)) return current;
      return [...current, { product, quantity: Math.max(1, product.min_order_quantity) }];
    });
  }, []);

  const changeQuantity = useCallback((productId: string, direction: 1 | -1) => {
    setLines((current) => current.flatMap((line) => {
      if (line.product.id !== productId) return [line];
      const { min_order_quantity: min, order_quantity_step: step, stock } = line.product;
      if (direction === 1) {
        const next = getNextValidQuantity(line.quantity, min, step, stock);
        return [next ? { ...line, quantity: next } : line];
      }
      const previous = getPreviousValidQuantity(line.quantity, min, step);
      return previous ? [{ ...line, quantity: previous }] : [];
    }));
  }, []);

  const removeLine = useCallback((productId: string) => {
    setLines((current) => current.filter((line) => line.product.id !== productId));
  }, []);

  const subtotal = useMemo(
    () => Math.round(lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0) * 100) / 100,
    [lines],
  );

  const violations = useMemo(() => {
    if (lines.length === 0) return [];
    const quantities = new Map(lines.map((line) => [line.product.id, line.quantity]));
    return validatePurchaseQuantityRules(
      quantities,
      lines.map((line) => ({
        id: line.product.id, name: line.product.name,
        min_order_quantity: line.product.min_order_quantity, order_quantity_step: line.product.order_quantity_step,
      })),
      groups ?? [],
    );
  }, [lines, groups]);

  const stockIssues = lines.filter((line) => line.quantity > line.product.stock).map((line) => line.product.name);

  // ── Livraison : un devis n'est valable que pour ce panier et cette adresse ──
  const quoteKey = useMemo(() => JSON.stringify({
    items: lines.map((line) => [line.product.id, line.quantity]),
    country: address.country.trim().toUpperCase(),
    zip: address.postal_code.trim(),
  }), [lines, address.country, address.postal_code]);
  const validQuote = fulfillment === 'delivery' && quote?.key === quoteKey ? quote : null;
  const shippingTotal = fulfillment === 'pickup' ? 0 : validQuote?.total ?? null;
  const estimatedTotal = shippingTotal === null ? null : Math.round((subtotal + shippingTotal) * 100) / 100;

  useEffect(() => { setQuoteMessage(null); }, [quoteKey]);

  async function requestQuote() {
    if (lines.length === 0 || !address.postal_code.trim() || !/^[A-Za-z]{2}$/.test(address.country.trim())) {
      setQuoteMessage('Ajoutez des produits, un code postal et un pays (code à 2 lettres).');
      return;
    }
    setQuoteLoading(true);
    setQuoteMessage(null);
    const key = quoteKey;
    try {
      const res = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: lines.map((line) => ({ product_id: line.product.id, weight_grams: line.product.weight_grams, quantity: line.quantity })),
          to: { country: address.country.trim().toUpperCase(), zip_code: address.postal_code.trim() },
        }),
      });
      const body = await res.json().catch(() => null) as {
        available?: boolean; message?: string; shippingTotal?: number; quoteToken?: string; shippingDetails?: Record<string, unknown> | null;
      } | null;
      if (!body?.available || typeof body.shippingTotal !== 'number' || !body.quoteToken) {
        setQuote(null);
        setQuoteMessage(body?.message ?? 'Livraison indisponible pour cette adresse.');
        return;
      }
      setQuote({ key, token: body.quoteToken, total: body.shippingTotal, details: body.shippingDetails ?? null });
    } catch {
      setQuoteMessage('Calcul impossible. Vérifiez la connexion et réessayez.');
    } finally {
      setQuoteLoading(false);
    }
  }

  function chooseSavedAddress(id: string) {
    setSelectedAddressId(id);
    const saved = savedAddresses.find((entry) => entry.id === id);
    if (saved) {
      setAddress({
        full_name: saved.full_name, line1: saved.line1, line2: saved.line2 ?? '',
        postal_code: saved.postal_code, city: saved.city, country: saved.country,
      });
    } else {
      setAddress(emptyAddress(defaultCountry, fullName));
    }
  }

  // ── Validation & envoi ────────────────────────────────────────────────────
  const hasContact = Boolean(email.trim() || phone.trim());
  const addressComplete = fulfillment === 'pickup'
    || Boolean(address.full_name.trim() && address.line1.trim() && address.city.trim() && address.postal_code.trim() && /^[A-Za-z]{2}$/.test(address.country.trim()));

  const blockers: string[] = [];
  if (!salesChannel) blockers.push('Choisissez l’origine de la commande.');
  if (!fullName.trim() && !customerId) blockers.push('Renseignez le nom du client.');
  if (!hasContact) blockers.push('Renseignez au moins un téléphone ou un e-mail.');
  if (lines.length === 0) blockers.push('Ajoutez au moins un produit.');
  if (groups === null && lines.length > 0) blockers.push('Règles de quantité indisponibles : réessayez dans un instant.');
  if (violations.length > 0) blockers.push(formatQuantityViolationMessage(violations[0]!));
  if (stockIssues.length > 0) blockers.push(`Stock insuffisant : ${stockIssues.join(', ')}.`);
  if (!addressComplete) blockers.push('Complétez l’adresse de livraison.');
  const draftBlockers = [...blockers];
  if (fulfillment === 'delivery' && !validQuote) blockers.push('Calculez les frais de livraison.');
  if (mode === 'paid' && !paidAt) blockers.push('Indiquez la date d’encaissement.');

  function contentPayload() {
    return {
      requestKey: requestKey.current,
      salesChannel,
      customer: { id: customerId, fullName: fullName.trim() || null, email: email.trim() || null, phone: phone.trim() || null },
      items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
      fulfillmentType: fulfillment,
      shippingAddress: fulfillment === 'delivery'
        ? { ...address, country: address.country.trim().toUpperCase(), line2: address.line2.trim() || null }
        : null,
      quoteToken: validQuote?.token ?? null,
      shippingDetails: validQuote?.details ?? null,
      adminNote: adminNote.trim() || null,
    };
  }

  async function submit(kind: 'main' | 'draft') {
    if (submitting) return;
    setError(null);
    const active = kind === 'draft' ? draftBlockers : blockers;
    if (active.length > 0) { setError(active[0]!); return; }
    setSubmitting(kind);
    try {
      let url = '/api/admin/assisted-orders';
      let method: 'POST' | 'PATCH' = 'POST';
      let payload: Record<string, unknown> = { ...contentPayload() };
      if (isEdit && initial) {
        url = `/api/admin/assisted-orders/${initial.preorderId}`;
        method = 'PATCH';
      } else if (kind === 'draft') {
        payload.mode = 'draft';
      } else if (mode === 'paid') {
        url = '/api/admin/assisted-orders/paid';
        payload = {
          ...payload,
          notifyCustomer: Boolean(email.trim()) && notifyCustomer,
          payment: {
            method: paidMethod,
            receivedAt: new Date(paidAt).toISOString(),
            reference: paidReference.trim() || null,
            note: paidNote.trim() || null,
          },
        };
      } else {
        payload.mode = mode;
        if (mode === 'to_verify') payload.declaredPayment = { method: declaredMethod, reference: declaredReference.trim() || null };
      }

      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok) {
        if (body?.code === 'SHIPPING_REQUOTE_REQUIRED') setQuote(null);
        setError(typeof body?.error === 'string' ? body.error : 'Enregistrement impossible. Réessayez.');
        return;
      }
      if (isEdit && initial) {
        router.push(`/admin/orders/precommandes/${initial.preorderId}?updated=1`);
      } else if (mode === 'paid' && kind === 'main' && typeof body?.orderId === 'string') {
        router.push(`/admin/orders/${body.orderId}`);
      } else if (typeof body?.id === 'string') {
        router.push(`/admin/orders/precommandes/${body.id}?created=1`);
      }
      router.refresh();
    } catch {
      setError('Connexion impossible. Vos saisies sont conservées : réessayez.');
    } finally {
      setSubmitting(null);
    }
  }

  const primaryLabel = isEdit
    ? 'Enregistrer les modifications'
    : mode === 'to_pay' ? 'Créer la précommande et le lien'
      : mode === 'to_verify' ? 'Enregistrer le paiement à vérifier'
        : 'Créer la commande payée';

  const summary = (
    <div className="space-y-3">
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-gray-500 dark:text-gray-400">Articles ({lines.reduce((sum, line) => sum + line.quantity, 0)})</dt><dd className="font-medium">{formatPrice(subtotal, currency)}</dd></div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-500 dark:text-gray-400">{fulfillment === 'pickup' ? 'Retrait en magasin' : 'Livraison'}</dt>
          <dd className="font-medium">{shippingTotal === null ? '—' : shippingTotal === 0 ? 'Offert' : formatPrice(shippingTotal, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-[var(--admin-border)] pt-2 text-base font-bold dark:border-gray-800">
          <dt>Total</dt><dd>{estimatedTotal === null ? '—' : formatPrice(estimatedTotal, currency)}</dd>
        </div>
      </dl>
      <p className="text-[11px] leading-4 text-gray-400">Montants recalculés par le serveur (prix catalogue, règles, livraison) à l’enregistrement.</p>
    </div>
  );

  return (
    <div className="grid items-start gap-5 pb-28 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-8">
      <div className="space-y-4">
        {isEdit && initial?.hadActiveLink && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <IconAlertTriangle size={18} className="mt-0.5 shrink-0" />
            Le lien de paiement déjà envoyé sera désactivé. La précommande repassera en brouillon : générez ensuite un nouveau lien.
          </p>
        )}

        {/* 1. Origine */}
        <section className={sectionClass} aria-labelledby="assisted-origin">
          <SectionTitle step={1} title="Origine de la commande" />
          <div id="assisted-origin" className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Origine">
            {SALES_CHANNELS.map((channel) => {
              const active = salesChannel === channel;
              return (
                <button
                  key={channel} type="button" role="radio" aria-checked={active} onClick={() => setSalesChannel(channel)}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${active ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'border-[var(--admin-border)] text-gray-700 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-200'}`}
                >
                  {CHANNEL_ICONS[channel]} {SALES_CHANNEL_LABELS[channel]}
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Client */}
        <section className={sectionClass}>
          <SectionTitle step={2} title="Client" helper="Aucun compte requis. Un téléphone suffit pour partager le lien par WhatsApp." />
          {customerId ? (
            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] p-3 dark:border-gray-700 dark:bg-gray-950/40">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Client existant</p>
                <button type="button" onClick={clearCustomer} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-gray-600 hover:bg-white dark:text-gray-300">
                  <IconX size={14} /> Changer
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label className="text-xs text-gray-500">Nom<input value={fullName} onChange={(e) => setFullName(e.target.value)} className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">Téléphone<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" className={`${inputClass} mt-1`} /></label>
              </div>
            </div>
          ) : newCustomer ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-xs text-gray-500">Nom *<input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">Téléphone<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+39 …" autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" className={`${inputClass} mt-1`} /></label>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Si ce téléphone ou cet e-mail existe déjà, la fiche client existante est réutilisée (aucun doublon). Aucun consentement marketing n’est enregistré.</p>
              <button type="button" onClick={() => setNewCustomer(false)} className="text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline">← Rechercher un client existant</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} type="search"
                  placeholder="Nom, téléphone ou e-mail…" aria-label="Rechercher un client" className={`${inputClass} pl-9`}
                />
                {customerSearching && <IconLoader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
              </div>
              {customerResults.length > 0 && (
                <ul className="divide-y divide-[var(--admin-border)] overflow-hidden rounded-xl border border-[var(--admin-border)] dark:divide-gray-800 dark:border-gray-700">
                  {customerResults.map((customer) => (
                    <li key={customer.id}>
                      <button type="button" onClick={() => selectCustomer(customer)} className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left hover:bg-[var(--admin-surface-subtle)] dark:hover:bg-gray-800">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{customer.full_name ?? customer.email ?? customer.phone}</span>
                        <span className="text-xs text-gray-500">{[customer.phone, customer.email].filter(Boolean).join(' · ') || 'Aucun contact'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {customerQuery.trim().length >= 2 && !customerSearching && customerResults.length === 0 && (
                <p className="text-xs text-gray-500">Aucun client trouvé.</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setNewCustomer(true);
                  const q = customerQuery.trim();
                  if (/^[+\d][\d\s.-]{5,}$/.test(q)) setPhone(q);
                  else if (q.includes('@')) setEmail(q);
                  else if (q) setFullName(q);
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-[var(--admin-border)] px-3 text-sm font-semibold text-gray-700 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-200"
              >
                <IconUserPlus size={17} /> Nouveau client
              </button>
            </div>
          )}
        </section>

        {/* 3. Produits */}
        <section className={sectionClass}>
          <SectionTitle step={3} title="Produits" helper="Catalogue réel du tenant — minimums, pas et groupes appliqués automatiquement." />
          <div className="relative">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={productQuery} onChange={(e) => setProductQuery(e.target.value)} type="search"
              placeholder="Rechercher un produit…" aria-label="Rechercher un produit" className={`${inputClass} pl-9`}
            />
            {productSearching && <IconLoader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
          </div>
          {productResults.length > 0 && (
            <ul className="mt-2 max-h-80 divide-y divide-[var(--admin-border)] overflow-y-auto rounded-xl border border-[var(--admin-border)] dark:divide-gray-800 dark:border-gray-700">
              {productResults.map((product) => {
                const purchasable = hasPurchasableQuantity(product.stock, product.min_order_quantity, product.order_quantity_step);
                const inCart = lines.find((line) => line.product.id === product.id);
                return (
                  <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                    {product.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={product.image_url} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-gray-50 object-cover" loading="lazy" />
                      : <span className="h-11 w-11 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{product.name}</p>
                      <p className="text-xs text-gray-500">
                        {formatPrice(product.price, currency)} · {purchasable ? `Stock ${product.stock}` : 'Indisponible'}
                        {(product.min_order_quantity > 1 || product.order_quantity_step > 1) && ` · Min ${product.min_order_quantity}, par ${product.order_quantity_step}`}
                      </p>
                    </div>
                    <button
                      type="button" disabled={!purchasable} onClick={() => addProduct(product)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-xl bg-[var(--admin-primary)] px-3 text-sm font-semibold text-white disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-800"
                      aria-label={`Ajouter ${product.name}`}
                    >
                      <IconPlus size={16} /> {inCart ? inCart.quantity : ''}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4">
            {initialLoading ? (
              <p className="flex items-center gap-2 text-sm text-gray-500"><IconLoader2 size={16} className="animate-spin" /> Chargement des articles…</p>
            ) : lines.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--admin-border)] px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">Aucun produit ajouté.</p>
            ) : (
              <ul className="divide-y divide-[var(--admin-border)] dark:divide-gray-800" aria-label="Panier">
                {lines.map((line) => {
                  const { product } = line;
                  const canIncrease = getNextValidQuantity(line.quantity, product.min_order_quantity, product.order_quantity_step, product.stock) !== null;
                  const atMinimum = getPreviousValidQuantity(line.quantity, product.min_order_quantity, product.order_quantity_step) === null;
                  return (
                    <li key={product.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{product.name}</p>
                        <p className="text-xs text-gray-500">{formatPrice(product.price, currency)} / unité{line.quantity > product.stock ? ' · stock insuffisant' : ''}</p>
                      </div>
                      <div className="flex items-center gap-1" role="group" aria-label={`Quantité ${product.name}`}>
                        <button type="button" onClick={() => changeQuantity(product.id, -1)} aria-label={atMinimum ? `Retirer ${product.name}` : `Diminuer ${product.name}`} className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--admin-border)] dark:border-gray-700">
                          {atMinimum ? <IconTrash size={16} /> : <IconMinus size={16} />}
                        </button>
                        <span className="min-w-10 text-center text-sm font-bold tabular-nums" aria-live="polite">{line.quantity}</span>
                        <button type="button" onClick={() => changeQuantity(product.id, 1)} disabled={!canIncrease} aria-label={`Augmenter ${product.name}`} className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--admin-border)] disabled:opacity-40 dark:border-gray-700">
                          <IconPlus size={16} />
                        </button>
                      </div>
                      <p className="w-20 text-right text-sm font-semibold">{formatPrice(product.price * line.quantity, currency)}</p>
                      {!atMinimum && (
                        <button type="button" onClick={() => removeLine(product.id)} aria-label={`Retirer ${product.name}`} className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-600">
                          <IconX size={16} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {violations.length > 0 && (
              <ul className="mt-2 space-y-1">
                {violations.map((violation, index) => (
                  <li key={index} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <IconAlertTriangle size={14} className="mt-0.5 shrink-0" /> {formatQuantityViolationMessage(violation)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 4. Remise */}
        <section className={sectionClass}>
          <SectionTitle step={4} title="Remise de la commande" />
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Mode de remise">
            {([['delivery', 'Livraison à domicile', <IconTruck key="t" size={18} />], ['pickup', 'Retrait en magasin', <IconBuildingStore key="s" size={18} />]] as const).map(([key, label, icon]) => (
              <button
                key={key} type="button" role="radio" aria-checked={fulfillment === key} onClick={() => setFulfillment(key)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold ${fulfillment === key ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'border-[var(--admin-border)] text-gray-700 dark:border-gray-700 dark:text-gray-200'}`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {fulfillment === 'delivery' && (
            <div className="mt-4 space-y-3">
              {savedAddresses.length > 0 && (
                <label className="block text-xs text-gray-500">
                  Adresse enregistrée
                  <select value={selectedAddressId} onChange={(e) => chooseSavedAddress(e.target.value)} className={`${inputClass} mt-1`}>
                    <option value="new">Nouvelle adresse</option>
                    {savedAddresses.map((saved) => (
                      <option key={saved.id} value={saved.id}>{saved.line1}, {saved.postal_code} {saved.city}{saved.is_default ? ' (par défaut)' : ''}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-gray-500 sm:col-span-2">Destinataire *<input value={address.full_name} onChange={(e) => setAddress({ ...address, full_name: e.target.value })} autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500 sm:col-span-2">Adresse *<input value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500 sm:col-span-2">Complément<input value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">Code postal *<input value={address.postal_code} onChange={(e) => setAddress({ ...address, postal_code: e.target.value })} inputMode="numeric" autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">Ville *<input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} autoComplete="off" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">Pays (ISO) *<input value={address.country} onChange={(e) => setAddress({ ...address, country: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} autoComplete="off" className={`${inputClass} mt-1 uppercase`} /></label>
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--admin-surface-subtle)] p-3 dark:bg-gray-950/40">
                <button type="button" onClick={requestQuote} disabled={quoteLoading} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">
                  {quoteLoading ? <IconLoader2 size={16} className="animate-spin" /> : <IconTruck size={16} />} {validQuote ? 'Recalculer' : 'Calculer les frais'}
                </button>
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  {validQuote ? <>Frais : <strong>{validQuote.total === 0 ? 'Offerts' : formatPrice(validQuote.total, currency)}</strong> · selon la configuration de livraison du magasin</>
                    : quote && !validQuote ? 'Panier ou adresse modifié : recalculez les frais.'
                      : 'Tarifs, zones et promotions du tenant appliqués.'}
                </p>
                {quoteMessage && <p className="w-full text-xs text-amber-700 dark:text-amber-300" role="alert">{quoteMessage}</p>}
              </div>
            </div>
          )}
        </section>

        {/* 5. Parcours */}
        {!isEdit && (
          <section className={sectionClass}>
            <SectionTitle step={5} title="Paiement" />
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Parcours de paiement">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.key} type="button" role="radio" aria-checked={mode === option.key} onClick={() => setMode(option.key)}
                  className={`rounded-xl border p-3 text-left transition-colors ${mode === option.key ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)]' : 'border-[var(--admin-border)] hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700'}`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{option.icon} {option.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">{option.helper}</span>
                </button>
              ))}
            </div>

            {mode === 'to_verify' && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-gray-500">Moyen déclaré par le client
                  <select value={declaredMethod} onChange={(e) => setDeclaredMethod(e.target.value as ManualPaymentMethod)} className={`${inputClass} mt-1`}>
                    {MANUAL_PAYMENT_METHODS.filter((m) => m !== 'cash').map((m) => <option key={m} value={m}>{MANUAL_PAYMENT_METHOD_LABELS[m]}</option>)}
                  </select>
                </label>
                <label className="text-xs text-gray-500">Référence communiquée (facultatif)<input value={declaredReference} onChange={(e) => setDeclaredReference(e.target.value)} className={`${inputClass} mt-1`} /></label>
                <p className="text-xs text-gray-500 sm:col-span-2">Aucune commande n’est créée tant que la réception n’est pas confirmée dans la fiche précommande.</p>
              </div>
            )}

            {mode === 'paid' && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-gray-500">Moyen d’encaissement *
                  <select value={paidMethod} onChange={(e) => setPaidMethod(e.target.value as ManualPaymentMethod)} className={`${inputClass} mt-1`}>
                    {MANUAL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{MANUAL_PAYMENT_METHOD_LABELS[m]}</option>)}
                  </select>
                </label>
                <label className="text-xs text-gray-500">Date d’encaissement *<input type="datetime-local" value={paidAt} max={nowLocalInput()} onChange={(e) => setPaidAt(e.target.value)} className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">Référence (facultatif)<input value={paidReference} onChange={(e) => setPaidReference(e.target.value)} placeholder="N° de virement, reçu…" className={`${inputClass} mt-1`} /></label>
                <label className="text-xs text-gray-500">Note d’encaissement<input value={paidNote} onChange={(e) => setPaidNote(e.target.value)} className={`${inputClass} mt-1`} /></label>
                <label className={`flex min-h-11 items-center gap-2 text-sm sm:col-span-2 ${email.trim() ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}>
                  <input type="checkbox" checked={Boolean(email.trim()) && notifyCustomer} disabled={!email.trim()} onChange={(e) => setNotifyCustomer(e.target.checked)} className="h-5 w-5" />
                  {email.trim() ? 'Envoyer le récapitulatif de commande au client par e-mail' : 'Pas d’e-mail : le lien de suivi sera à partager manuellement'}
                </label>
                <p className="text-xs text-gray-500 sm:col-span-2">Enregistrement tracé avec votre identité. Le stock est décrémenté une seule fois à la création.</p>
              </div>
            )}
          </section>
        )}

        <section className={sectionClass}>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">
            Note interne (jamais visible par le client)
            <textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value.slice(0, 1000))} rows={2} className={`${inputClass} mt-1 py-2`} />
          </label>
        </section>
      </div>

      {/* Récapitulatif */}
      <aside className="hidden lg:sticky lg:top-4 lg:block">
        <div className={sectionClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Récapitulatif</h2>
          {summary}
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</p>}
          <button type="button" onClick={() => submit('main')} disabled={Boolean(submitting)} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {submitting === 'main' ? <IconLoader2 size={16} className="animate-spin" /> : <IconCheck size={16} />} {primaryLabel}
          </button>
          {!isEdit && (
            <button type="button" onClick={() => submit('draft')} disabled={Boolean(submitting)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--admin-border)] px-4 text-sm font-semibold text-gray-700 hover:bg-[var(--admin-surface-subtle)] disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">
              {submitting === 'draft' ? 'Enregistrement…' : 'Enregistrer comme brouillon'}
            </button>
          )}
          <Link href={isEdit && initial ? `/admin/orders/precommandes/${initial.preorderId}` : '/admin'} className="mt-2 flex min-h-11 items-center justify-center text-sm font-semibold text-gray-500 hover:text-gray-800">Annuler</Link>
        </div>
      </aside>

      {/* Barre mobile */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--admin-border)] bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,.08)] backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 lg:hidden">
        {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{error}</p>}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Total estimé</p>
            <p className="text-lg font-bold">{estimatedTotal === null ? formatPrice(subtotal, currency) + ' + livr.' : formatPrice(estimatedTotal, currency)}</p>
          </div>
          {!isEdit && (
            <button type="button" onClick={() => submit('draft')} disabled={Boolean(submitting)} aria-label="Enregistrer comme brouillon" className="min-h-12 rounded-xl border border-[var(--admin-border)] px-3 text-sm font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">
              Brouillon
            </button>
          )}
          <button type="button" onClick={() => submit('main')} disabled={Boolean(submitting)} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">
            {submitting === 'main' ? <IconLoader2 size={16} className="animate-spin" /> : <IconCheck size={16} />}
            {isEdit ? 'Enregistrer' : mode === 'paid' ? 'Créer la commande' : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  );
}
