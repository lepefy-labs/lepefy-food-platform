'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  IconExternalLink, IconChevronDown, IconTrash, IconTruck, IconBuildingStore, IconAlertTriangle, IconCreditCard,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { getMaximumValidQuantity, getNextValidQuantity, getPreviousValidQuantity, formatQuantityViolationMessage } from '@/lib/purchaseQuantityRules';
import { useQuantityGroups } from '@/lib/cart/useQuantityGroups';
import { computeCartQuantityViolations } from '@/lib/cart/cartQuantityValidation';
import { QuantityGroupProgress } from '@/components/cart/QuantityGroupProgress';
import type { CartItem } from '@lepefy/types';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import {
  PaymentOptionList, buildExternalPaymentOptions, ExternalPaymentNote,
} from '@/components/payment/ExternalPaymentMethodPicker';
import ConfirmActionModal from '@/components/ui/ConfirmActionModal';
import { CustomerAddressForm } from '@/components/address/CustomerAddressForm';
import {
  countryLabel,
  draftToShippingAddress,
  emptyAddressDraft,
  isValidPostalCode,
  normalizePostalCode,
  shippingAddressToDraft,
  validateAddressDraft,
  type AddressDraft,
  type AddressField,
} from '@/lib/address/addressRules';
import { ADDRESS_COPY } from '@/lib/storefrontCopy/addressCopy';
import { missingFieldsTitle } from '@/lib/storefrontCopy/copy';
import type { PublicTenant, TenantPaymentMethod, ShippingAddress } from '@lepefy/types';

interface SessionItem {
  productId:    string;
  name:         string;
  price:        number;
  quantity:     number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  min_order_quantity?: number;
  order_quantity_step?: number;
  stock?: number;
  active?: boolean;
}

interface SessionData {
  id:                   string;
  email:                string;
  fullName:             string | null;
  phone:                string | null;
  fulfillmentType:      'delivery' | 'pickup';
  shippingAddress:      ShippingAddress | null;
  shippingDetails:      Record<string, unknown> | null;
  shippingTotal:        number;
  items:                SessionItem[];
  paymentMethod:        'stripe' | 'external_link';
  externalPaymentType:  string | null;
  externalPaymentLabel: string | null;
  externalPaymentLink:  string | null;
}

interface CheckoutSessionEditorProps {
  tenant:       PublicTenant;
  externalPaymentMethods: TenantPaymentMethod[];
  sessionId:    string;
  accessToken?: string;
  onCancelled?: () => void;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

export function CheckoutSessionEditor({
  tenant, externalPaymentMethods, sessionId, accessToken, onCancelled,
}: CheckoutSessionEditorProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [data, setData]           = useState<SessionData | null>(null);

  const [expanded, setExpanded]       = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);
  const [isSaving, setIsSaving]       = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [payError, setPayError]       = useState<string | null>(null);
  const [payAsStripe, setPayAsStripe] = useState(false);
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);

  const [editItems, setEditItems]           = useState<SessionItem[]>([]);
  const { groups, loading: groupsLoading, error: groupsError, reload: reloadGroups } = useQuantityGroups();
  const [editPaymentMethod, setEditPaymentMethod] = useState<'stripe' | 'external_link'>('stripe');
  const [editExternalMethodId, setEditExternalMethodId] = useState<string | null>(null);
  const [editFulfillmentType, setEditFulfillmentType]   = useState<'delivery' | 'pickup'>('delivery');
  const [editAddress, setEditAddress]       = useState<AddressDraft>(() => emptyAddressDraft('IT'));
  const [addressSubmitted, setAddressSubmitted] = useState(false);
  const [editQuoteToken, setEditQuoteToken] = useState<string | null>(null);
  const [editShippingTotal, setEditShippingTotal] = useState(0);
  const [requoting, setRequoting]           = useState(false);
  const [requoteError, setRequoteError]     = useState<string | null>(null);

  const fetchUrl = accessToken
    ? `/api/checkout-sessions/${sessionId}?token=${encodeURIComponent(accessToken)}`
    : `/api/checkout-sessions/${sessionId}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) {
          if (!cancelled) setLoadState('unavailable');
          return;
        }
        const json = (await res.json()) as SessionData;
        if (cancelled) return;

        setData(json);
        setEditItems(json.items);
        setEditPaymentMethod(json.paymentMethod);
        setEditFulfillmentType(json.fulfillmentType);
        setEditShippingTotal(json.shippingTotal);

        const matchingMethod = externalPaymentMethods.find((m) => m.method === json.externalPaymentType);
        setEditExternalMethodId(matchingMethod?.id ?? null);

        if (json.shippingAddress) {
          const draft = shippingAddressToDraft(json.shippingAddress);
          delete draft.fullName;
          setEditAddress(draft);
        }

        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('unavailable');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl]);

  const cartItems: CartItem[] = editItems.map((item) => ({
    product: {
      id: item.productId, name: item.name, slug: '',
      price: item.price, image_url: null, weight_grams: null,
      storage_type: item.storage_type, stock: item.stock ?? 0,
      min_order_quantity: item.min_order_quantity ?? 1,
      order_quantity_step: item.order_quantity_step ?? 1,
    },
    quantity: item.quantity,
  }));
  const quantityViolations = computeCartQuantityViolations(cartItems, groups);
  const stockBlocked = editItems.find((item) =>
    item.active === false || item.stock === undefined || item.quantity > item.stock ||
    getMaximumValidQuantity(item.stock, item.min_order_quantity ?? 1, item.order_quantity_step ?? 1) === 0
  );
  const quantityError = groupsLoading ? 'Vérification des règles du panier…' : groupsError
    ?? (quantityViolations[0] ? formatQuantityViolationMessage(quantityViolations[0]) : null)
    ?? (stockBlocked ? `Stock insuffisant ou produit indisponible : ${stockBlocked.name}.` : null);
  const editSubtotal = editItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const editTotal = editSubtotal + (editFulfillmentType === 'pickup' ? 0 : editShippingTotal);

  const editPostalCode = normalizePostalCode(editAddress.country, editAddress.postalCode);

  // Devis lié au pays et au code postal seulement : demandé avec un code complet.
  const requoteShipping = useCallback(async (country: string, zip: string) => {
    if (!isValidPostalCode(country, zip)) return;
    setRequoting(true);
    setRequoteError(null);
    try {
      const res = await fetch('/api/shipping/quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          items: editItems.map((i) => ({ product_id: i.productId, weight_grams: null, quantity: i.quantity })),
          to:    { country, zip_code: zip },
        }),
      });
      const json = await res.json();
      if (json.available) {
        setEditShippingTotal(json.shippingTotal);
        setEditQuoteToken(json.quoteToken ?? null);
      } else {
        setRequoteError(json.message ?? ADDRESS_COPY.deliveryUnavailable);
        setEditQuoteToken(null);
      }
    } catch {
      setRequoteError('Erreur lors du calcul des frais de livraison.');
      setEditQuoteToken(null);
    } finally {
      setRequoting(false);
    }
  }, [editItems]);

  // Modification ouverte en livraison sans devis valide : nouveau devis dès que
  // le pays et le code postal sont complets (jamais à chaque touche).
  useEffect(() => {
    if (!expanded || editFulfillmentType !== 'delivery' || editQuoteToken) return;
    if (!isValidPostalCode(editAddress.country, editPostalCode)) return;
    const timer = window.setTimeout(() => { void requoteShipping(editAddress.country, editPostalCode); }, 500);
    return () => window.clearTimeout(timer);
  }, [expanded, editFulfillmentType, editQuoteToken, editAddress.country, editPostalCode, requoteShipping]);

  function changeEditAddress(next: AddressDraft, changed: AddressField[]) {
    const keyBefore = `${editAddress.country}|${editPostalCode}`;
    const keyAfter = `${next.country}|${normalizePostalCode(next.country, next.postalCode)}`;
    if ((changed.includes('country') || changed.includes('postalCode')) && keyBefore !== keyAfter) {
      setEditQuoteToken(null);
      setRequoteError(null);
    }
    setEditAddress(next);
  }

  // Tarif remplacé, panier ou adresse modifiés depuis le devis : le serveur
  // refuse le montant enregistré. Nouveau devis + nouvelle confirmation.
  function handleShippingRequote(json: { code?: string; error?: string }): boolean {
    if (json.code !== 'SHIPPING_REQUOTE_REQUIRED') return false;
    setPayAsStripe(false);
    setExpanded(true);
    setEditQuoteToken(null);
    setSaveError(json.error ?? 'Les frais de livraison doivent être recalculés. Vérifiez le nouveau montant avant de payer.');
    if (editFulfillmentType === 'delivery') void requoteShipping(editAddress.country, editPostalCode);
    return true;
  }

  function updateQty(productId: string, direction: -1 | 1) {
    setEditItems((prev) => prev.map((item) => {
      if (item.productId !== productId) return item;
      const minimum = item.min_order_quantity ?? 1;
      const step = item.order_quantity_step ?? 1;
      const next = direction > 0
        ? getNextValidQuantity(item.quantity, minimum, step, item.stock ?? 0)
        : getPreviousValidQuantity(item.quantity, minimum, step);
      return next !== null ? { ...item, quantity: next } : item;
    }));
  }

  function removeItem(productId: string) {
    setEditItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  async function saveAndPay() {
    setSaveError(null);

    if (editItems.length === 0) {
      setSaveError('Le panier ne peut pas être vide.');
      return;
    }
    if (quantityError) {
      setSaveError(quantityError);
      return;
    }
    if (editPaymentMethod === 'external_link' && !editExternalMethodId) {
      setSaveError('Veuillez choisir un moyen de paiement.');
      return;
    }
    if (editFulfillmentType === 'delivery') {
      const addressErrors = validateAddressDraft(editAddress);
      const missing = Object.keys(addressErrors).length;
      if (missing > 0) {
        setAddressSubmitted(true);
        setSaveError(`${missingFieldsTitle(missing)} Complétez les champs en rouge.`);
        return;
      }
      if (!editQuoteToken) {
        setSaveError(requoteError ?? ADDRESS_COPY.quoteLoading);
        return;
      }
    }

    setIsSaving(true);
    try {
      const shippingAddress: ShippingAddress | null = editFulfillmentType === 'delivery'
        ? draftToShippingAddress(editAddress, data?.shippingAddress?.full_name || data?.fullName || '')
        : null;

      const res = await fetch(`/api/checkout-sessions/${sessionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items:            editItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          fulfillmentType:  editFulfillmentType,
          shippingAddress,
          shippingTotal:    editFulfillmentType === 'pickup' ? 0 : editShippingTotal,
          quoteToken:       editFulfillmentType === 'pickup' ? null : editQuoteToken,
          paymentMethod:    editPaymentMethod,
          externalPaymentMethodId: editPaymentMethod === 'external_link' ? editExternalMethodId ?? undefined : undefined,
          accessToken,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (!handleShippingRequote(json)) setSaveError(json.error ?? 'Une erreur est survenue.');
        return;
      }

      setData({
        ...(json as SessionData),
        items: (json.items as SessionItem[]).map((item) => {
          const meta = editItems.find((current) => current.productId === item.productId);
          return { ...item, min_order_quantity: meta?.min_order_quantity,
            order_quantity_step: meta?.order_quantity_step, stock: meta?.stock, active: meta?.active };
        }),
      });
      setExpanded(false);

      if (editPaymentMethod === 'external_link') return;
      setPayAsStripe(true);
    } catch {
      setSaveError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSaving(false);
    }
  }

  async function createIntent() {
    if (quantityError) return { error: quantityError };
    try {
      const res = await fetch(`/api/checkout-sessions/${sessionId}/create-intent`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accessToken }),
      });
      const json = await res.json();
      if (!res.ok) {
        handleShippingRequote(json);
        return { error: json.error ?? 'Une erreur est survenue.' };
      }
      setStripeClientSecret(json.clientSecret ?? null);
      return { clientSecret: json.clientSecret, reference_id: sessionId };
    } catch {
      return { error: 'Une erreur est survenue.' };
    }
  }

  async function handleCancel() {
    setIsCancelling(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/checkout-sessions/${sessionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'cancelled', accessToken }),
      });
      if (res.ok) {
        setCancelModalOpen(false);
        onCancelled?.();
      } else {
        const json = await res.json();
        setSaveError(json.error ?? 'Une erreur est survenue lors de l\'annulation.');
      }
    } catch {
      setSaveError('Une erreur est survenue lors de l\'annulation.');
    } finally {
      setIsCancelling(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="max-w-md mx-auto px-4 py-10 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/2 mb-3" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  if (loadState === 'unavailable' || !data) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4">
          <IconAlertTriangle size={26} />
        </div>
        <h1 className="text-lg font-bold mb-2">Cette demande de paiement n&apos;est plus disponible</h1>
        <p className="text-sm text-gray-500 mb-6">
          Elle a peut-être déjà été traitée ou annulée.
        </p>
        <Link href="/cart" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          Retourner au panier
        </Link>
      </div>
    );
  }

  const isPaypal = data.paymentMethod === 'external_link' && data.externalPaymentType === 'paypal';

  return (
    <>
      <div className="max-w-md mx-auto px-4 py-8">
        <div className="bg-gray-50 rounded-2xl p-5 mb-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Montant</span>
            <span className="text-lg font-bold">
              {formatPrice(data.items.reduce((s, i) => s + i.price * i.quantity, 0) + data.shippingTotal, tenant.currency)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Paiement</span>
            <span className="text-sm font-semibold">
              {data.paymentMethod === 'stripe' ? 'Carte bancaire' : data.externalPaymentLabel ?? 'Lien externe'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">{data.fulfillmentType === 'pickup' ? 'Retrait' : 'Livraison'}</span>
            <span className="text-sm font-semibold text-right">
              {data.fulfillmentType === 'pickup'
                ? 'En boutique'
                : data.shippingAddress
                  ? `${data.shippingAddress.city}, ${countryLabel(data.shippingAddress.country)}`
                  : 'Non renseignée'}
            </span>
          </div>
        </div>

        {data.paymentMethod === 'external_link' && data.externalPaymentLink && (
          <div className="space-y-2 mb-6">
            <a
              href={data.externalPaymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-white text-sm"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Payer maintenant <IconExternalLink size={16} />
            </a>
            {isPaypal ? (
              <p className="text-xs text-gray-500 text-center">
                Sélectionnez « Amis et famille » lors du paiement pour éviter les frais.
              </p>
            ) : (
              <p className="text-xs text-gray-500 text-center">
                Le montant n&apos;est pas prérempli : saisissez-le manuellement.
              </p>
            )}
            <p className="text-xs text-gray-400 text-center">
              Généralement vérifié en quelques heures, parfois jusqu&apos;à 24-48h selon les jours.
              Merci de votre patience, vous recevrez un email dès la confirmation.
            </p>
          </div>
        )}

        {data.paymentMethod === 'stripe' && !payAsStripe && (
          <button
            type="button"
            onClick={() => setPayAsStripe(true)}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm mb-6"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Payer maintenant
          </button>
        )}

        {payAsStripe && (
          <div className="mb-6">
            {payError && (
              <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 mb-3">{payError}</p>
            )}
            <StripePaymentStep
              key={stripeClientSecret ?? 'pending'}
              module="shop"
              amount={editTotal || data.items.reduce((s, i) => s + i.price * i.quantity, 0) + data.shippingTotal}
              currency={tenant.currency}
              color="var(--color-primary)"
              returnUrl={typeof window !== 'undefined' ? `${window.location.origin}/order-confirmation` : ''}
              referenceId={sessionId}
              payLabel={`Payer ${formatPrice(editTotal || 0, tenant.currency)}`}
              processingLabel="Traitement en cours…"
              billingCountryHint="Si un pays est demandé ci-dessous, indiquez celui associé à votre carte bancaire (facturation), pas votre position actuelle."
              createIntent={createIntent}
              onError={(msg) => setPayError(msg)}
              onSucceeded={() => {
                window.location.href = '/order-confirmation';
              }}
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between text-sm text-gray-500 hover:text-gray-800 py-2"
        >
          <span>Modifier la commande</span>
          <IconChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <div className="space-y-6 mt-3 pt-4 border-t border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Mode de paiement</p>
              <PaymentOptionList
                options={[
                  {
                    key:      'stripe',
                    selected: editPaymentMethod === 'stripe',
                    onSelect: () => setEditPaymentMethod('stripe'),
                    icon:     <IconCreditCard size={16} stroke={1.8} className="text-white" />,
                    color:    'var(--color-primary)',
                    label:    'Carte bancaire',
                    sub:      'Paiement sécurisé, confirmation immédiate',
                  },
                  ...buildExternalPaymentOptions(
                    externalPaymentMethods,
                    editPaymentMethod === 'external_link' ? editExternalMethodId : null,
                    (id) => { setEditPaymentMethod('external_link'); setEditExternalMethodId(id); },
                  ),
                ]}
              />
              {editPaymentMethod === 'external_link' && editExternalMethodId && (
                <ExternalPaymentNote
                  method={externalPaymentMethods.find((m) => m.id === editExternalMethodId)!}
                  total={editTotal}
                  currency={tenant.currency}
                />
              )}
            </div>

            {tenant.click_collect_enabled && (
              <div className="flex gap-3">
                {(['delivery', 'pickup'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setEditFulfillmentType(type)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium flex items-center justify-center gap-1.5 ${
                      editFulfillmentType === type
                        ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {type === 'delivery' ? <IconTruck size={16} /> : <IconBuildingStore size={16} />}
                    {type === 'delivery' ? 'Livraison' : 'Click & Collect'}
                  </button>
                ))}
              </div>
            )}

            {editFulfillmentType === 'delivery' && (
              <section aria-labelledby="session-address-title" className="flex flex-col gap-4">
                <h2 id="session-address-title" className="text-base font-bold text-gray-950">{ADDRESS_COPY.title}</h2>
                <CustomerAddressForm
                  idPrefix="reprise-adresse"
                  value={editAddress}
                  onChange={changeEditAddress}
                  showAllErrors={addressSubmitted}
                  searchMode="collapsed"
                  autofillSection="shipping"
                />
                <div aria-live="polite">
                  {requoting ? (
                    <p className="rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm font-semibold text-gray-800" role="status">{ADDRESS_COPY.quoteLoading}</p>
                  ) : requoteError ? (
                    <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800" role="alert">{requoteError}</p>
                  ) : editQuoteToken ? (
                    <p className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-900">
                      <span className="font-bold">{ADDRESS_COPY.deliveryAvailable}</span>{' '}{ADDRESS_COPY.deliveryPriceLabel} {formatPrice(editShippingTotal, tenant.currency)}
                    </p>
                  ) : null}
                </div>
              </section>
            )}

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Articles</p>
              <div className="space-y-2">
                {editItems.map((item) => (
                  <div key={item.productId} className="flex items-center gap-3 bg-white rounded-xl p-3 border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-1">{item.name}</p>
                      <p className="text-xs text-gray-400">{formatPrice(item.price, tenant.currency)} · Minimum {item.min_order_quantity ?? 1}{(item.order_quantity_step ?? 1) > 1 ? ` · par ${item.order_quantity_step}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, -1)}
                         disabled={getPreviousValidQuantity(item.quantity, item.min_order_quantity ?? 1, item.order_quantity_step ?? 1) === null}
                        className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, 1)}
                         disabled={getNextValidQuantity(item.quantity, item.min_order_quantity ?? 1, item.order_quantity_step ?? 1, item.stock ?? 0) === null}
                        className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      className="text-gray-300 hover:text-red-400 flex-shrink-0"
                      aria-label="Supprimer"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm mt-3 px-1">
                <span className="text-gray-500">Sous-total (indicatif)</span>
                <span className="font-semibold">{formatPrice(editSubtotal, tenant.currency)}</span>
              </div>
            </div>
              <QuantityGroupProgress groups={groups} items={cartItems} />
              {quantityError && (
                <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {quantityError}
                  {groupsError && (
                    <button type="button" onClick={reloadGroups} className="ml-2 min-h-11 font-bold underline">Réessayer</button>
                  )}
                </div>
              )}


            {saveError && (
              <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{saveError}</p>
            )}

            <button
              type="button"
              onClick={saveAndPay}
              disabled={isSaving}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {isSaving ? 'Enregistrement…' : 'Enregistrer et payer'}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setCancelModalOpen(true)}
          disabled={isCancelling}
          className="w-full text-center text-xs text-gray-400 hover:text-red-500 mt-6 disabled:opacity-50"
        >
          {isCancelling ? 'Annulation…' : 'Annuler cette demande'}
        </button>
      </div>

      <ConfirmActionModal
        open={cancelModalOpen}
        title="Annuler cette demande de paiement ?"
        description="La reprise de cet achat ne sera plus disponible. Cette action est définitive."
        confirmLabel="Annuler la demande"
        cancelLabel="Conserver"
        destructive
        loading={isCancelling}
        onCancel={() => {
          if (!isCancelling) setCancelModalOpen(false);
        }}
        onConfirm={() => void handleCancel()}
      />
    </>
  );
}
