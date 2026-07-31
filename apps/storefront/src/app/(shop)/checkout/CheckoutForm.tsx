'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { IconMapPin, IconClock, IconCreditCard, IconBuildingStore, IconChevronDown } from '@tabler/icons-react';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/utils/format';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { OtpLoginForm } from '@/components/auth/OtpLoginForm';
import type { CustomerProfile } from '@/lib/customers/types';
import type { Tenant } from '@lepefy/types';

// Chargement paresseux — appelé uniquement au rendu de l'étape de paiement
// Stripe (step === 'payment'), jamais pour un client qui choisit le retrait
// en boutique : ce module est importé/monté pour CHAQUE checkout, delivery
// ou pickup, in_store ou stripe.
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
  }
  return stripePromise;
}

const formSchema = z.object({
  firstName:   z.string().min(1, 'Prénom requis'),
  lastName:    z.string().min(1, 'Nom requis'),
  email:       z.string().email('Email invalide'),
  phone:       z.string().optional(),
  street:      z.string().optional(),
  houseNumber: z.string().optional(),
  city:        z.string().optional(),
  postal_code: z.string().optional(),
  country:     z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface CheckoutShipping {
  shippingTotal:   number;
  shippingDetails: Record<string, unknown> | null;
  quoteToken:      string | null;
  fulfillmentType: 'delivery' | 'pickup';
  country:         string | null;
  postalCode:      string | null;
  street:          string | null;
  houseNumber:     string | null;
  city:            string | null;
}

function readStoredShipping(): CheckoutShipping | null {
  if (typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem('lepefy-checkout-shipping');
  if (!stored) return null;
  try {
    return JSON.parse(stored) as CheckoutShipping;
  } catch {
    return null;
  }
}

type PaymentMode = 'stripe' | 'in_store';

// ─── Pré-remplissage : helpers de mapping profil → champs du formulaire ───────
// Le formulaire éclate en deux ce que la base stocke en un seul champ
// (customers.full_name → prénom + nom, addresses.line1 → rue + numéro). Ces
// deux fonctions font le chemin inverse, sans jamais perdre d'information :
// tout ce qui n'est pas identifié reste dans le premier champ.

function splitFullName(fullName: string | null): { firstName: string; lastName: string } {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

function splitLine1(line1: string): { street: string; houseNumber: string } {
  const parts = line1.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: line1.trim(), houseNumber: '' };
  const last = parts[parts.length - 1] ?? '';
  // Numéro de rue = dernier token contenant un chiffre, ou le « s.n. » proposé
  // par le formulaire pour les adresses sans numéro.
  if (/\d/.test(last) || /^s\.?\s?n\.?$/i.test(last)) {
    return { street: parts.slice(0, -1).join(' '), houseNumber: last };
  }
  return { street: parts.join(' '), houseNumber: '' };
}

// ─── Stripe payment step ──────────────────────────────────────────────────────

function StripePaymentStep({
  total,
  tenant,
  onError,
}: {
  total:   number;
  tenant:  Tenant;
  onError: (msg: string) => void;
}) {
  const stripe   = useStripe();
  const elements = useElements();
  const router   = useRouter();
  const { clearCart } = useCartStore();
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setIsConfirming(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/order-confirmation`,
      },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message ?? 'Erreur lors du paiement.');
      setIsConfirming(false);
    } else {
      clearCart();
      router.push(`/order-confirmation?payment_intent=${paymentIntent?.id ?? ''}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
        <p className="text-sm font-semibold text-gray-700 mb-4">Paiement sécurisé</p>
        <PaymentElement />
      </div>
      <button
        onClick={handleConfirm}
        disabled={isConfirming || !stripe || !elements}
        className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isConfirming ? 'Traitement en cours…' : `Payer ${formatPrice(total, tenant.currency)}`}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CheckoutForm({ tenant }: { tenant: Tenant }) {
  const { items, totalPrice, shippingPayload } = useCartStore();
  const router = useRouter();

  const { customer: sessionCustomer, refresh: refreshSessionCustomer } = useSessionCustomer();
  const [showLoginForm, setShowLoginForm] = useState(false);

  const [shippingInfo, setShippingInfo] = useState<CheckoutShipping | null>(() => readStoredShipping());
  const [step, setStep]                 = useState<'form' | 'payment'>('form');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentMode, setPaymentMode]   = useState<PaymentMode>('stripe');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);

  // Ces trois valeurs peuvent changer pendant le checkout si l'utilisateur
  // modifie le code postal ou le pays : le quoteToken doit toujours
  // correspondre exactement à l'adresse envoyée à /api/checkout.
  const [shippingTotal, setShippingTotal]     = useState<number>(
    shippingInfo && shippingInfo.fulfillmentType !== 'pickup' ? shippingInfo.shippingTotal : 0,
  );
  const [shippingDetails, setShippingDetails] = useState<Record<string, unknown> | null>(
    shippingInfo?.shippingDetails ?? null,
  );
  const [quoteToken, setQuoteToken]           = useState<string | null>(shippingInfo?.quoteToken ?? null);
  const [shippingRecalcError, setShippingRecalcError]         = useState<string | null>(null);
  const [shippingRecalculating, setShippingRecalculating]     = useState(false);
  const [quotedFor, setQuotedFor] = useState<{ country: string; postalCode: string } | null>(
    shippingInfo?.country && shippingInfo?.postalCode
      ? { country: shippingInfo.country, postalCode: shippingInfo.postalCode }
      : null,
  );
  const recalcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { register, handleSubmit, watch, setValue, getValues, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      street:      shippingInfo?.street ?? '',
      houseNumber: shippingInfo?.houseNumber ?? '',
      city:        shippingInfo?.city ?? '',
      postal_code: shippingInfo?.postalCode ?? '',
      country:     shippingInfo?.country ?? '',
    },
  });

  useEffect(() => {
    if (!shippingInfo) {
      router.push('/cart');
      return;
    }
    if (items.length === 0) router.push('/cart');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pré-remplissage depuis le profil client ────────────────────────────────
  // Se déclenche au montage si la session existe déjà, et après une connexion
  // en cours de checkout (refreshSessionCustomer met à jour sessionCustomer).
  // Une seule fois par client : si le client corrige un champ puis se
  // reconnecte, on ne réécrit pas par-dessus sa saisie.
  const [prefilledAddress, setPrefilledAddress] = useState(false);
  const prefilledForCustomerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionCustomer) return;
    if (prefilledForCustomerRef.current === sessionCustomer.id) return;
    prefilledForCustomerRef.current = sessionCustomer.id;

    let cancelled = false;

    (async () => {
      let profile: CustomerProfile | null = null;
      try {
        const res = await fetch('/api/customers/me');
        if (!res.ok) return;
        profile = (await res.json()) as CustomerProfile;
      } catch {
        // Confort, pas prérequis : en cas d'échec le formulaire reste vide et
        // le checkout se déroule normalement.
        return;
      }
      if (cancelled || !profile) return;

      // On ne remplit QUE les champs encore vides : ce qui vient de l'étape
      // panier (pays / code postal ayant servi au devis Packlink) et tout ce
      // que le client a déjà tapé priment toujours sur le profil.
      const fillIfEmpty = (field: keyof FormValues, value: string | null | undefined) => {
        if (!value) return;
        if ((getValues(field) ?? '').trim() !== '') return;
        setValue(field, value, { shouldValidate: false, shouldDirty: false });
      };

      const { firstName, lastName } = splitFullName(profile.fullName);
      fillIfEmpty('firstName', firstName);
      fillIfEmpty('lastName',  lastName);
      fillIfEmpty('email',     profile.email);
      fillIfEmpty('phone',     profile.phone);

      const addr = profile.defaultAddress;
      if (addr) {
        const { street, houseNumber } = splitLine1(addr.line1);
        fillIfEmpty('street',      street);
        fillIfEmpty('houseNumber', houseNumber);
        fillIfEmpty('city',        addr.city);
        fillIfEmpty('postal_code', addr.postalCode);
        fillIfEmpty('country',     addr.country);
        if (!cancelled) setPrefilledAddress(true);
      }
    })();

    return () => { cancelled = true; };
  }, [sessionCustomer, getValues, setValue]);

  const subtotal        = totalPrice();
  const fulfillmentType = shippingInfo?.fulfillmentType ?? 'delivery';
  const isPickup        = fulfillmentType === 'pickup';
  const effectiveShippingTotal = isPickup ? 0 : shippingTotal;
  const total            = subtotal + effectiveShippingTotal;

  // ── Recalcul live si le code postal / pays change en checkout ──────────────
  const watchedPostalCode = watch('postal_code');
  const watchedCountry    = watch('country');

  useEffect(() => {
    if (fulfillmentType !== 'delivery') return;
    const zip = (watchedPostalCode ?? '').trim();
    const c   = (watchedCountry ?? '').trim();
    if (zip.length < 4 || !c) return;
    if (quotedFor && quotedFor.country === c && quotedFor.postalCode === zip) return;

    if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    recalcDebounceRef.current = setTimeout(async () => {
      setShippingRecalculating(true);
      setShippingRecalcError(null);
      try {
        const res = await fetch('/api/shipping/quote', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            items: shippingPayload(),
            to:    { country: c, zip_code: zip },
          }),
        });
        const data = await res.json();
        if (data.available) {
          setShippingTotal(data.shippingTotal);
          setShippingDetails(data.shippingDetails ?? null);
          setQuoteToken(data.quoteToken ?? null);
          setQuotedFor({ country: c, postalCode: zip });
        } else {
          setShippingRecalcError(data.message ?? 'Livraison non disponible pour cette adresse.');
          setQuoteToken(null);
        }
      } catch {
        setShippingRecalcError('Erreur lors du calcul des frais de livraison.');
        setQuoteToken(null);
      } finally {
        setShippingRecalculating(false);
      }
    }, 800);

    return () => {
      if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    };
  }, [watchedPostalCode, watchedCountry, fulfillmentType, quotedFor, shippingPayload]);

  const isSubmitDisabled =
    isSubmitting ||
    (fulfillmentType === 'delivery' && (shippingRecalculating || quoteToken === null));

  const onSubmit = async (data: FormValues) => {
    if (fulfillmentType === 'delivery' && (!data.street || !data.houseNumber || !data.city || !data.postal_code)) {
      setSubmitError('Veuillez compléter votre adresse de livraison.');
      return;
    }
    if (fulfillmentType === 'delivery' && quoteToken === null) {
      setSubmitError('Veuillez corriger votre adresse pour recalculer les frais de livraison.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        items: items.map((i) => ({
          productId:    i.product.id,
          name:         i.product.name,
          price:        i.product.price,
          quantity:     i.quantity,
          storage_type: i.product.storage_type ?? 'dry',
        })),
        shippingAddress:
          fulfillmentType === 'delivery'
            ? {
                full_name:   `${data.firstName} ${data.lastName}`,
                line1:       `${data.street} ${data.houseNumber}`.trim(),
                city:        data.city,
                postal_code: data.postal_code,
                country:     data.country ?? shippingInfo?.country ?? 'IT',
              }
            : null,
        fulfillmentType,
        email:           data.email,
        phone:           data.phone ?? null,
        fullName:        `${data.firstName} ${data.lastName}`,
        shippingTotal:   effectiveShippingTotal,
        shippingDetails: isPickup ? null : shippingDetails,
        quoteToken:      isPickup ? null : quoteToken,
        paymentMethod:   isPickup ? paymentMode : 'stripe',
      };

      const res = await fetch('/api/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        setSubmitError(result.error ?? 'Une erreur est survenue.');
        return;
      }

      // In-store flow: order created directly, redirect immediately
      if (paymentMode === 'in_store') {
        const { clearCart } = useCartStore.getState();
        clearCart();
        router.push(`/order-confirmation?order_id=${result.orderId}`);
        return;
      }

      // Stripe flow: proceed to payment step
      setClientSecret(result.clientSecret);
      setStep('payment');
    } catch {
      setSubmitError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!shippingInfo) return null;

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-8">
      <h1 className="text-2xl font-bold mb-6">Finaliser la commande</h1>

      {/* Order summary */}
      <div className="bg-gray-50 rounded-2xl p-4 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">Récapitulatif</p>
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.product.id} className="flex justify-between text-sm">
              <span className="text-gray-600 line-clamp-1 mr-2">
                {item.product.name} × {item.quantity}
              </span>
              <span className="font-medium flex-shrink-0">
                {formatPrice(item.product.price * item.quantity, tenant.currency)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-200 mt-3 pt-3 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-500">
            <span>Sous-total</span>
            <span>{formatPrice(subtotal, tenant.currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Livraison</span>
            <span>
              {shippingRecalculating ? (
                <span className="text-gray-400 text-xs animate-pulse">Recalcul en cours…</span>
              ) : effectiveShippingTotal === 0 ? (
                <span className="text-green-600 font-medium">Gratuit</span>
              ) : (
                formatPrice(effectiveShippingTotal, tenant.currency)
              )}
            </span>
          </div>
          <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-1">
            <span>Total</span>
            <span>{formatPrice(total, tenant.currency)}</span>
          </div>
          {!isPickup && shippingRecalcError && (
            <p className="text-red-500 text-xs text-right">{shippingRecalcError}</p>
          )}
        </div>
      </div>

      {/* Step 1: Contact + address form */}
      {step === 'form' && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          {/* Guest → compte, optionnel — n'interrompt jamais le checkout guest */}
          {sessionCustomer ? (
            <p className="text-xs text-gray-400">
              Connecté(e) en tant que <span className="font-medium text-gray-600">{sessionCustomer.email}</span> — cette commande te fera gagner des points.
            </p>
          ) : showLoginForm ? (
            <OtpLoginForm onAuthenticated={() => { refreshSessionCustomer(); setShowLoginForm(false); }} />
          ) : (
            <button
              type="button"
              onClick={() => setShowLoginForm(true)}
              className="w-full flex items-center justify-between text-left text-xs text-gray-500 bg-gray-50 rounded-xl px-4 py-3"
            >
              <span>Tu as un compte ? Connecte-toi pour gagner des points sur cette commande</span>
              <IconChevronDown size={16} className="flex-shrink-0 ml-2" />
            </button>
          )}

          {/* Customer info */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Vos informations</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input {...register('firstName')} placeholder="Prénom" className={inputClass} />
                  {errors.firstName && (
                    <p className="text-red-500 text-xs mt-1">{errors.firstName.message}</p>
                  )}
                </div>
                <div>
                  <input {...register('lastName')} placeholder="Nom" className={inputClass} />
                  {errors.lastName && (
                    <p className="text-red-500 text-xs mt-1">{errors.lastName.message}</p>
                  )}
                </div>
              </div>
              <div>
                <input
                  {...register('email')}
                  type="email"
                  inputMode="email"
                  placeholder="Email"
                  className={inputClass}
                />
                {errors.email && (
                  <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
                )}
              </div>
              <input
                {...register('phone')}
                type="tel"
                inputMode="tel"
                placeholder="Téléphone (optionnel)"
                className={inputClass}
              />
              {sessionCustomer && (
                <p className="text-[11px] text-gray-400">
                  Informations pré-remplies depuis votre compte — modifiables si vous commandez pour quelqu&apos;un d&apos;autre.
                </p>
              )}
            </div>
          </div>

          {/* Delivery address */}
          {fulfillmentType === 'delivery' && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Adresse de livraison</p>
              {prefilledAddress && (
                <p className="text-[11px] text-gray-400 -mt-2 mb-3">
                  Votre adresse habituelle — vous pouvez la modifier pour cette commande.
                </p>
              )}
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <input {...register('street')} placeholder="Rue" className={inputClass} />
                  </div>
                  <div>
                    <input {...register('houseNumber')} placeholder="Numéro" className={inputClass} />
                    <p className="text-[11px] text-gray-400 mt-1">
                      Indiquez « s.n. » si votre adresse n&apos;a pas de numéro
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    {...register('postal_code')}
                    placeholder="Code postal"
                    inputMode="numeric"
                    className={inputClass}
                  />
                  <input {...register('city')} placeholder="Ville" className={inputClass} />
                </div>
                <input {...register('country')} placeholder="Pays" className={inputClass} />
              </div>
            </div>
          )}

          {/* Click & Collect info */}
          {isPickup && tenant.click_collect_address && (
            <div className="bg-blue-50 rounded-2xl p-4 text-sm space-y-1">
              <p className="font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
                <IconMapPin size={16} /> Adresse de retrait
              </p>
              <p className="text-blue-700">{tenant.click_collect_address}</p>
              {tenant.click_collect_hours && (
                <p className="text-blue-600 flex items-center gap-1.5">
                  <IconClock size={14} /> {tenant.click_collect_hours}
                </p>
              )}
              <p style={{ color: '#3B82F6' }} className="pt-1 text-xs">
                Votre commande sera prête dans quelques heures. Vous recevrez un email dès qu&apos;elle est disponible.
              </p>
            </div>
          )}

          {/* Payment method selector — pickup only */}
          {isPickup && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Mode de paiement</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMode('stripe')}
                  className={`flex-1 py-3 px-3 rounded-xl border text-xs font-medium text-center transition-all ${
                    paymentMode === 'stripe'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light,#f0fdf4)]'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <IconCreditCard size={20} className="mx-auto mb-0.5" />
                  Carte / Satispay
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMode('in_store')}
                  className={`flex-1 py-3 px-3 rounded-xl border text-xs font-medium text-center transition-all ${
                    paymentMode === 'in_store'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light,#f0fdf4)]'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <IconBuildingStore size={20} className="mx-auto mb-0.5" />
                  Payer en boutique
                </button>
              </div>
            </div>
          )}

          {submitError && (
            <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isSubmitting
              ? 'Traitement…'
              : shippingRecalculating
                ? 'Recalcul des frais de livraison…'
                : paymentMode === 'in_store'
                  ? `Confirmer la commande — ${formatPrice(total, tenant.currency)}`
                  : 'Continuer vers le paiement'
            }
          </button>
        </form>
      )}

      {/* Step 2: Stripe Payment */}
      {step === 'payment' && clientSecret && (
        <div>
          {submitError && (
            <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 mb-4">
              {submitError}
            </p>
          )}
          <Elements stripe={getStripe()} options={{ clientSecret, locale: 'fr' }}>
            <StripePaymentStep
              total={total}
              tenant={tenant}
              onError={(msg) => setSubmitError(msg)}
            />
          </Elements>
        </div>
      )}
    </div>
  );
}
