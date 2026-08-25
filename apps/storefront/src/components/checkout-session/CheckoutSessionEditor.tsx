'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  IconExternalLink, IconChevronDown, IconTrash, IconTruck, IconBuildingStore, IconAlertTriangle, IconCreditCard,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import {
  PaymentOptionList, buildExternalPaymentOptions, ExternalPaymentNote,
} from '@/components/payment/ExternalPaymentMethodPicker';
import ConfirmActionModal from '@/components/ui/ConfirmActionModal';
import type { Tenant, TenantPaymentMethod, ShippingAddress } from '@lepefy/types';

const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

function splitLine1(line1: string): { street: string; houseNumber: string } {
  const parts = line1.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: line1.trim(), houseNumber: '' };
  const last = parts[parts.length - 1] ?? '';
  if (/\d/.test(last) || /^s\.?\s?n\.?$/i.test(last)) {
    return { street: parts.slice(0, -1).join(' '), houseNumber: last };
  }
  return { street: parts.join(' '), houseNumber: '' };
}

interface SessionItem {
  productId:    string;
  name:         string;
  price:        number;
  quantity:     number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
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
  tenant:       Tenant;
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
  const [editPaymentMethod, setEditPaymentMethod] = useState<'stripe' | 'external_link'>('stripe');
  const [editExternalMethodId, setEditExternalMethodId] = useState<string | null>(null);
  const [editFulfillmentType, setEditFulfillmentType]   = useState<'delivery' | 'pickup'>('delivery');
  const [editStreet, setEditStreet]         = useState('');
  const [editHouseNumber, setEditHouseNumber] = useState('');
  const [editCity, setEditCity]             = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [editCountry, setEditCountry]       = useState('IT');
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
          const { street, houseNumber } = splitLine1(json.shippingAddress.line1);
          setEditStreet(street);
          setEditHouseNumber(houseNumber);
          setEditCity(json.shippingAddress.city);
          setEditPostalCode(json.shippingAddress.postal_code);
          setEditCountry(json.shippingAddress.country);
        }

        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('unavailable');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl]);

  const editSubtotal = editItems.reduce((s, i) => s + i.price * i.quantity, 0);
  const editTotal = editSubtotal + (editFulfillmentType === 'pickup' ? 0 : editShippingTotal);

  const requoteShipping = useCallback(async (country: string, zip: string) => {
    if (zip.trim().length < 4 || !country) return;
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
        setRequoteError(json.message ?? 'Livraison non disponible pour cette adresse.');
        setEditQuoteToken(null);
      }
    } catch {
      setRequoteError('Erreur lors du calcul des frais de livraison.');
      setEditQuoteToken(null);
    } finally {
      setRequoting(false);
    }
  }, [editItems]);

  function updateQty(productId: string, quantity: number) {
    setEditItems((prev) => {
      if (quantity <= 0) return prev.filter((i) => i.productId !== productId);
      return prev.map((i) => (i.productId === productId ? { ...i, quantity } : i));
    });
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
    if (editPaymentMethod === 'external_link' && !editExternalMethodId) {
      setSaveError('Veuillez choisir un moyen de paiement.');
      return;
    }
    if (editFulfillmentType === 'delivery' && !editQuoteToken) {
      setSaveError('Veuillez renseigner une adresse de livraison valide pour recalculer les frais.');
      return;
    }

    setIsSaving(true);
    try {
      const shippingAddress: ShippingAddress | null = editFulfillmentType === 'delivery'
        ? {
            full_name:   data?.fullName ?? '',
            line1:       `${editStreet} ${editHouseNumber}`.trim(),
            city:        editCity,
            postal_code: editPostalCode,
            country:     editCountry,
          }
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
        setSaveError(json.error ?? 'Une erreur est survenue.');
        return;
      }

      setData(json as SessionData);
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
    try {
      const res = await fetch(`/api/checkout-sessions/${sessionId}/create-intent`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accessToken }),
      });
      const json = await res.json();
      if (!res.ok) return { error: json.error ?? 'Une erreur est survenue.' };
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
                  ? `${data.shippingAddress.city}, ${data.shippingAddress.country}`
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
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">Adresse de livraison</p>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <input
                      value={editStreet}
                      onChange={(e) => setEditStreet(e.target.value)}
                      placeholder="Rue"
                      className="col-span-2 w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                    />
                    <input
                      value={editHouseNumber}
                      onChange={(e) => setEditHouseNumber(e.target.value)}
                      placeholder="Numéro"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={editPostalCode}
                      onChange={(e) => {
                        const zip = e.target.value;
                        setEditPostalCode(zip);
                        setEditQuoteToken(null);
                        if (zip.trim().length >= 4) requoteShipping(editCountry, zip);
                      }}
                      placeholder="Code postal"
                      inputMode="numeric"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                    />
                    <input
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      placeholder="Ville"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
                    />
                  </div>
                  <select
                    value={editCountry}
                    onChange={(e) => {
                      const c = e.target.value;
                      setEditCountry(c);
                      setEditQuoteToken(null);
                      if (editPostalCode.trim().length >= 4) requoteShipping(c, editPostalCode);
                    }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <div className="flex justify-between items-center text-sm px-1">
                    <span className="text-gray-500">Frais de livraison</span>
                    {requoting ? (
                      <span className="text-gray-400 text-xs animate-pulse">Calcul…</span>
                    ) : requoteError ? (
                      <span className="text-red-500 text-xs">{requoteError}</span>
                    ) : (
                      <span className="font-semibold">{formatPrice(editShippingTotal, tenant.currency)}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Articles</p>
              <div className="space-y-2">
                {editItems.map((item) => (
                  <div key={item.productId} className="flex items-center gap-3 bg-white rounded-xl p-3 border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-1">{item.name}</p>
                      <p className="text-xs text-gray-400">{formatPrice(item.price, tenant.currency)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, item.quantity - 1)}
                        className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(item.productId, item.quantity + 1)}
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
