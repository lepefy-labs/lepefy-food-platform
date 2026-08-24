'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  IconArrowLeft,
  IconBuildingStore,
  IconCheck,
  IconChevronDown,
  IconCreditCard,
  IconLock,
  IconMapPin,
  IconTruck,
  IconUser,
  IconPhone,
} from '@tabler/icons-react';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { OtpLoginForm } from '@/components/auth/OtpLoginForm';
import {
  PaymentOptionList,
  buildExternalPaymentOptions,
  ExternalPaymentNote,
  externalPaymentCtaColor,
  externalPaymentCtaLabel,
} from '@/components/payment/ExternalPaymentMethodPicker';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import type { CheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { marketingConsentLabel } from '@/lib/legal/consentCopy';
import { usePaymentRedirectRecovery } from '@/lib/payments/usePaymentRedirectRecovery';
import type { CustomerProfile } from '@/lib/customers/types';
import type { FreeShippingInfo } from '@/lib/shipping/freeShippingInfo';
import { formatPrice } from '@/lib/utils/format';
import { useCartStore } from '@/stores/cartStore';
import type { Tenant, TenantPaymentMethod } from '@lepefy/types';
import { CheckoutProgressIndicator } from './CheckoutProgressIndicator';

const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

type Step = 'shipping' | 'select-payment' | 'payment';
type FulfillmentType = 'delivery' | 'pickup';
type PaymentMode = 'stripe' | 'in_store';

const contactSchema = z.object({
  firstName: z.string().trim().min(1, 'Prénom requis'),
  lastName: z.string().trim().min(1, 'Nom requis'),
  email: z.string().trim().email('Email invalide'),
  phone: z.string().trim().min(6, 'Téléphone requis'),
});

type ContactValues = z.infer<typeof contactSchema>;

interface CheckoutDraft {
  fulfillmentType: FulfillmentType;
  shippingTotal: number;
  shippingDetails: Record<string, unknown> | null;
  freeShipping: FreeShippingInfo;
  quoteToken: string | null;
  country: string;
  postalCode: string;
  street: string;
  houseNumber: string;
  city: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

function readDraft(): CheckoutDraft | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem('lepefy-checkout-shipping');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fullName = typeof parsed.fullName === 'string' ? parsed.fullName.trim().split(/\s+/) : [];
    return {
      fulfillmentType: parsed.fulfillmentType === 'pickup' ? 'pickup' : 'delivery',
      shippingTotal: typeof parsed.shippingTotal === 'number' ? parsed.shippingTotal : 0,
      shippingDetails: (parsed.shippingDetails as Record<string, unknown> | null) ?? null,
      freeShipping: (parsed.freeShipping as FreeShippingInfo) ?? null,
      quoteToken: typeof parsed.quoteToken === 'string' ? parsed.quoteToken : null,
      country: typeof parsed.country === 'string' && parsed.country ? parsed.country : 'IT',
      postalCode: typeof parsed.postalCode === 'string' ? parsed.postalCode : '',
      street: typeof parsed.street === 'string' ? parsed.street : '',
      houseNumber: typeof parsed.houseNumber === 'string' ? parsed.houseNumber : '',
      city: typeof parsed.city === 'string' ? parsed.city : '',
      firstName: typeof parsed.firstName === 'string' ? parsed.firstName : (fullName[0] ?? ''),
      lastName: typeof parsed.lastName === 'string' ? parsed.lastName : fullName.slice(1).join(' '),
      email: typeof parsed.email === 'string' ? parsed.email : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
    };
  } catch {
    return null;
  }
}

function splitLine1(line1: string): { street: string; houseNumber: string } {
  const parts = line1.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: line1.trim(), houseNumber: '' };
  const last = parts[parts.length - 1] ?? '';
  if (/\d/.test(last) || /^s\.?\s?n\.?$/i.test(last)) return { street: parts.slice(0, -1).join(' '), houseNumber: last };
  return { street: parts.join(' '), houseNumber: '' };
}

export default function CheckoutFlow({
  tenant,
  externalPaymentMethods = [],
  consentState,
  isE2ETest = false,
}: {
  tenant: Tenant;
  externalPaymentMethods?: TenantPaymentMethod[];
  consentState: CheckoutConsentState;
  isE2ETest?: boolean;
}) {
  const router = useRouter();
  const { items, totalPrice, shippingPayload } = useCartStore();
  const initialDraftRef = useRef<CheckoutDraft | null>(null);
  if (initialDraftRef.current === null && typeof window !== 'undefined') initialDraftRef.current = readDraft();
  const initialDraft = initialDraftRef.current;

  const { customer: sessionCustomer, refresh: refreshSessionCustomer } = useSessionCustomer();
  const [step, setStep] = useState<Step>('shipping');
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>(initialDraft?.fulfillmentType ?? 'delivery');
  const [country, setCountry] = useState(initialDraft?.country ?? 'IT');
  const [postalCode, setPostalCode] = useState(initialDraft?.postalCode ?? '');
  const [street, setStreet] = useState(initialDraft?.street ?? '');
  const [houseNumber, setHouseNumber] = useState(initialDraft?.houseNumber ?? '');
  const [city, setCity] = useState(initialDraft?.city ?? '');
  const [manualMode, setManualMode] = useState(false);
  const [addressLocked, setAddressLocked] = useState(Boolean(initialDraft?.quoteToken && initialDraft.street));
  const [shippingTotal, setShippingTotal] = useState(initialDraft?.shippingTotal ?? 0);
  const [shippingDetails, setShippingDetails] = useState<Record<string, unknown> | null>(initialDraft?.shippingDetails ?? null);
  const [freeShipping, setFreeShipping] = useState<FreeShippingInfo>(initialDraft?.freeShipping ?? null);
  const [quoteToken, setQuoteToken] = useState<string | null>(initialDraft?.quoteToken ?? null);
  const [quotedFor, setQuotedFor] = useState<{ country: string; postalCode: string } | null>(
    initialDraft?.quoteToken && initialDraft.postalCode ? { country: initialDraft.country, postalCode: initialDraft.postalCode } : null,
  );
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('stripe');
  const [selectedExternalMethodId, setSelectedExternalMethodId] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [ambassadorDiscount, setAmbassadorDiscount] = useState(0);
  const recalcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripeSessionIdRef = useRef<string | null>(null);
  const stripeSessionSnapshotRef = useRef<string | null>(null);
  const prefilledForCustomerRef = useRef<string | null>(null);
  const addressSectionRef = useRef<HTMLElement | null>(null);

  const { register, handleSubmit, setValue, getValues, setFocus, watch, formState: { errors } } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      firstName: initialDraft?.firstName ?? '',
      lastName: initialDraft?.lastName ?? '',
      email: initialDraft?.email ?? '',
      phone: initialDraft?.phone ?? '',
    },
  });

  const firstName = watch('firstName');
  const lastName = watch('lastName');
  const email = watch('email');
  const phone = watch('phone');

  usePaymentRedirectRecovery('shop', () => {
    useCartStore.getState().clearCart();
    sessionStorage.removeItem('lepefy-checkout-shipping');
    router.push('/order-confirmation');
  });

  useEffect(() => {
    if (items.length === 0) router.push('/cart');
  }, [items.length, router]);

  useEffect(() => {
    if (!sessionCustomer || prefilledForCustomerRef.current === sessionCustomer.id) return;
    prefilledForCustomerRef.current = sessionCustomer.id;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/customers/me');
        if (!response.ok) return;
        const profile = (await response.json()) as CustomerProfile;
        if (cancelled) return;
        const parts = (profile.fullName ?? '').trim().split(/\s+/).filter(Boolean);
        if (!getValues('firstName')) setValue('firstName', parts[0] ?? '');
        if (!getValues('lastName')) setValue('lastName', parts.slice(1).join(' '));
        if (!getValues('email')) setValue('email', profile.email ?? '');
        if (!getValues('phone')) setValue('phone', profile.phone ?? '');
        if (profile.defaultAddress && !postalCode && !street) {
          const line = splitLine1(profile.defaultAddress.line1);
          setCountry(profile.defaultAddress.country || 'IT');
          setPostalCode(profile.defaultAddress.postalCode);
          setStreet(line.street);
          setHouseNumber(line.houseNumber);
          setCity(profile.defaultAddress.city);
          setManualMode(true);
        }
      } catch {
        // Profile prefill is optional.
      }
    })();
    return () => { cancelled = true; };
  }, [sessionCustomer, getValues, setValue, postalCode, street]);

  const subtotal = totalPrice();
  const isPickup = fulfillmentType === 'pickup';
  const effectiveShippingTotal = isPickup ? 0 : shippingTotal;
  const total = subtotal + effectiveShippingTotal - ambassadorDiscount;
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const hasCompleteAddress = Boolean(country.trim() && postalCode.trim() && street.trim() && houseNumber.trim() && city.trim());
  const recipientComplete = Boolean(firstName?.trim() && lastName?.trim());
  const contactComplete = Boolean(email?.trim() && phone?.trim().length >= 6);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/checkout/ambassador-discount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtotal }),
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setAmbassadorDiscount(typeof data.discount === 'number' ? data.discount : 0);
      } catch {
        // Server recalculates the discount at checkout creation.
      }
    })();
    return () => { cancelled = true; };
  }, [subtotal, sessionCustomer?.id]);

  const saveDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    const contact = getValues();
    sessionStorage.setItem('lepefy-checkout-shipping', JSON.stringify({
      fulfillmentType,
      shippingTotal: isPickup ? 0 : shippingTotal,
      shippingDetails: isPickup ? null : shippingDetails,
      freeShipping: isPickup ? null : freeShipping,
      quoteToken: isPickup ? null : quoteToken,
      country: isPickup ? null : country,
      postalCode: isPickup ? null : postalCode,
      street: isPickup ? null : street,
      houseNumber: isPickup ? null : houseNumber,
      city: isPickup ? null : city,
      fullName: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim(),
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    }));
  }, [city, country, freeShipping, fulfillmentType, getValues, houseNumber, isPickup, postalCode, quoteToken, shippingDetails, shippingTotal, street]);

  const quoteShipping = useCallback(async (destinationCountry: string, zip: string) => {
    if (zip.trim().length < 4) return;
    setShippingLoading(true);
    setShippingError(null);
    try {
      const response = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: shippingPayload(), to: { country: destinationCountry, zip_code: zip.trim() } }),
      });
      const data = await response.json();
      if (!response.ok || !data.available) {
        setQuoteToken(null);
        setShippingError(data.message ?? 'Livraison non disponible pour cette adresse.');
        return;
      }
      setShippingTotal(data.shippingTotal);
      setShippingDetails(data.shippingDetails ?? null);
      setFreeShipping(data.freeShipping ?? null);
      setQuoteToken(data.quoteToken ?? null);
      setQuotedFor({ country: destinationCountry, postalCode: zip.trim() });
    } catch {
      setQuoteToken(null);
      setShippingError('Erreur lors du calcul des frais de livraison.');
    } finally {
      setShippingLoading(false);
    }
  }, [shippingPayload]);

  useEffect(() => {
    if (fulfillmentType !== 'delivery' || postalCode.trim().length < 4) return;
    if (quotedFor?.country === country && quotedFor.postalCode === postalCode.trim()) return;
    if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    recalcDebounceRef.current = setTimeout(() => { void quoteShipping(country, postalCode); }, 700);
    return () => { if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current); };
  }, [country, fulfillmentType, postalCode, quoteShipping, quotedFor]);

  function invalidateQuote() {
    setQuoteToken(null);
    setShippingDetails(null);
    setFreeShipping(null);
    setQuotedFor(null);
    setShippingError(null);
  }

  function focusAddressSection(message?: string) {
    if (message) setSubmitError(message);
    setAddressLocked(false);
    requestAnimationFrame(() => {
      addressSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => {
        const input = addressSectionRef.current?.querySelector<HTMLInputElement>('input');
        input?.focus({ preventScroll: true });
      }, 350);
    });
  }

  function changeFulfillment(next: FulfillmentType) {
    setFulfillmentType(next);
    setSubmitError(null);
    if (next === 'pickup') {
      setQuoteToken(null);
      setShippingError(null);
    } else {
      invalidateQuote();
    }
  }

  const continueFromInformation = (data: ContactValues) => {
    if (!isPickup && !hasCompleteAddress) {
      focusAddressSection('Indiquez une adresse complète pour calculer vos frais de livraison.');
      return;
    }
    if (!isPickup && !quoteToken) {
      focusAddressSection(shippingError ?? 'Le calcul de la livraison est en cours. Veuillez patienter un instant.');
      return;
    }
    if (!data.firstName || !data.lastName || !data.email || !data.phone) return;
    saveDraft();
    setSubmitError(null);
    setStep('select-payment');
  };

  function focusFirstContactError() {
    if (!firstName?.trim()) setFocus('firstName');
    else if (!lastName?.trim()) setFocus('lastName');
    else if (!email?.trim()) setFocus('email');
    else setFocus('phone');
  }

  function buildSharedPayload() {
    const data = getValues();
    return {
      items: items.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        price: item.product.price,
        quantity: item.quantity,
        storage_type: item.product.storage_type ?? 'dry',
      })),
      shippingAddress: isPickup ? null : {
        full_name: `${data.firstName} ${data.lastName}`,
        line1: `${street} ${houseNumber}`.trim(),
        city,
        postal_code: postalCode,
        country,
      },
      fulfillmentType,
      email: data.email,
      phone: data.phone,
      fullName: `${data.firstName} ${data.lastName}`,
      shippingDetails: isPickup ? null : shippingDetails,
      quoteToken: isPickup ? null : quoteToken,
      termsAccepted: consentState.showTermsCheckbox ? termsAccepted : undefined,
      marketingOptIn: consentState.showMarketingCheckbox ? marketingOptIn : undefined,
    };
  }

  async function createIntent() {
    try {
      const sharedPayload = buildSharedPayload();
      const snapshot = JSON.stringify({ ...sharedPayload, shippingTotal: effectiveShippingTotal });
      if (stripeSessionIdRef.current && stripeSessionSnapshotRef.current !== snapshot) stripeSessionIdRef.current = null;

      if (stripeSessionIdRef.current) {
        const retryResponse = await fetch(`/api/checkout-sessions/${stripeSessionIdRef.current}/create-intent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        });
        if (retryResponse.ok) {
          const retryResult = await retryResponse.json();
          return { clientSecret: retryResult.clientSecret, reference_id: stripeSessionIdRef.current };
        }
        if (retryResponse.status !== 404) {
          const retryResult = await retryResponse.json().catch(() => ({}));
          return { error: retryResult.error ?? 'Une erreur est survenue.' };
        }
        stripeSessionIdRef.current = null;
      }

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sharedPayload, shippingTotal: effectiveShippingTotal, paymentMethod: 'stripe' as const }),
      });
      const result = await response.json();
      if (!response.ok) return { error: result.error ?? 'Une erreur est survenue.' };
      stripeSessionIdRef.current = result.sessionId ?? null;
      stripeSessionSnapshotRef.current = snapshot;
      return { clientSecret: result.clientSecret, reference_id: result.sessionId ?? null };
    } catch {
      return { error: 'Une erreur est survenue.' };
    }
  }

  async function confirmPaymentChoice() {
    if (consentState.showTermsCheckbox && !termsAccepted) {
      setSubmitError('Merci d’accepter les Conditions Générales de Vente pour continuer.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const sharedPayload = buildSharedPayload();
      if (selectedExternalMethodId) {
        const response = await fetch('/api/checkout/external-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...sharedPayload, externalPaymentMethodId: selectedExternalMethodId }),
        });
        const result = await response.json();
        if (!response.ok) { setSubmitError(result.error ?? 'Une erreur est survenue.'); return; }
        sessionStorage.setItem('lepefy-pending-payment', JSON.stringify({
          sessionId: result.sessionId, link: result.link, amount: result.amount, currency: result.currency,
          isPaypal: result.isPaypal, label: result.label, accessToken: result.accessToken,
        }));
        router.push(`/checkout/en-attente?ref=${result.sessionId}`);
        return;
      }

      if (isPickup && paymentMode === 'in_store') {
        const response = await fetch('/api/checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...sharedPayload, shippingTotal: 0, paymentMethod: 'in_store' as const }),
        });
        const result = await response.json();
        if (!response.ok) { setSubmitError(result.error ?? 'Une erreur est survenue.'); return; }
        useCartStore.getState().clearCart();
        sessionStorage.removeItem('lepefy-checkout-shipping');
        router.push(`/order-confirmation?order_id=${result.orderId}`);
        return;
      }

      saveDraft();
      setStep('payment');
    } catch {
      setSubmitError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const compactSummary = (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <button type="button" onClick={() => setShowOrderDetails((value) => !value)} className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left">
        <span>
          <span className="block text-xs font-medium text-gray-500">Total</span>
          <span className="text-lg font-black text-gray-950">{formatPrice(total, tenant.currency)}</span>
          <span className="ml-2 text-xs text-gray-500">· {itemCount} article{itemCount > 1 ? 's' : ''}</span>
        </span>
        <IconChevronDown size={18} className={`text-gray-500 transition-transform ${showOrderDetails ? 'rotate-180' : ''}`} />
      </button>
      {showOrderDetails && (
        <div className="border-t border-gray-100 px-4 py-3 text-sm">
          {items.map((item) => (
            <div key={item.product.id} className="flex justify-between gap-4 py-1.5"><span className="min-w-0 truncate text-gray-600">{item.quantity}× {item.product.name}</span><span className="font-medium">{formatPrice(item.product.price * item.quantity, tenant.currency)}</span></div>
          ))}
          <div className="mt-2 flex justify-between border-t border-gray-100 pt-2"><span className="text-gray-500">Livraison</span><span className="font-semibold">{isPickup ? 'Gratuit' : quoteToken ? formatPrice(shippingTotal, tenant.currency) : 'À calculer'}</span></div>
          {ambassadorDiscount > 0 && <div className="flex justify-between py-1.5 text-green-700"><span>Avantage ambassadeur</span><span>-{formatPrice(ambassadorDiscount, tenant.currency)}</span></div>}
        </div>
      )}
    </section>
  );

  if (items.length === 0) return null;

  const selectedExternalMethod = externalPaymentMethods.find((method) => method.id === selectedExternalMethodId) ?? null;
  const paymentCtaLabel = selectedExternalMethod
    ? externalPaymentCtaLabel(selectedExternalMethod, 'la commande')
    : paymentMode === 'in_store' ? 'Confirmer le retrait en boutique' : 'Continuer avec carte bancaire';
  const paymentCtaColor = selectedExternalMethod ? externalPaymentCtaColor(selectedExternalMethod) : paymentMode === 'in_store' ? '#8a8578' : 'var(--color-primary)';

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-10 sm:px-6 sm:py-7">
      <CheckoutProgressIndicator currentStep={step} />
      <div className="mb-5">{compactSummary}</div>

      {step === 'shipping' && (
        <div className="space-y-5">
          <section className="rounded-2xl bg-[color-mix(in_srgb,var(--color-primary)_6%,white)] px-4 py-3.5">
            <p className="text-sm font-bold text-gray-950">{isPickup ? 'Préparez votre retrait' : 'Préparez votre livraison'}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              Renseignez la personne qui reçoit ou retire la commande, puis les informations nécessaires pour la livraison et le contact.
            </p>
          </section>

          <section>
            <h1 className="text-lg font-bold text-gray-950">Mode de récupération</h1>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(['delivery', 'pickup'] as const).filter((type) => type === 'delivery' || tenant.click_collect_enabled).map((type) => {
                const active = fulfillmentType === type;
                return (
                  <button key={type} type="button" onClick={() => changeFulfillment(type)} className={`relative min-h-[92px] rounded-2xl border p-4 text-left transition-colors ${active ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_5%,white)]' : 'border-gray-200 bg-white'}`}>
                    <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${active ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 text-gray-500'}`}>{type === 'delivery' ? <IconTruck size={18} /> : <IconBuildingStore size={18} />}</span>
                    <span className="block text-sm font-bold text-gray-950">{type === 'delivery' ? 'Livraison' : 'Click & Collect'}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{type === 'delivery' ? 'Recevez votre commande à l’adresse indiquée' : 'Retirez votre commande en boutique'}</span>
                    {active && <IconCheck size={16} className="absolute right-3 top-3 text-[var(--color-primary)]" />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${recipientComplete ? 'bg-green-600 text-white' : 'bg-[var(--color-primary)] text-white'}`}>{recipientComplete ? <IconCheck size={15} /> : '1'}</span>
              <div>
                <h2 className="text-sm font-bold text-gray-950">{isPickup ? 'Personne qui retire' : 'Destinataire'}</h2>
                <p className="mt-0.5 text-xs text-gray-500">Nom utilisé pour remettre ou livrer la commande.</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div><input {...register('firstName')} autoComplete="given-name" placeholder="Prénom" className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" />{errors.firstName && <p className="mt-1 text-xs font-medium text-red-600">{errors.firstName.message}</p>}</div>
              <div><input {...register('lastName')} autoComplete="family-name" placeholder="Nom" className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" />{errors.lastName && <p className="mt-1 text-xs font-medium text-red-600">{errors.lastName.message}</p>}</div>
            </div>
          </section>

          {isPickup ? (
            <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white"><IconCheck size={15} /></span>
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold text-blue-900"><IconMapPin size={17} /> Retrait chez {tenant.name}</p>
                  {tenant.click_collect_address && <p className="mt-2 text-sm text-blue-800">{tenant.click_collect_address}</p>}
                  <p className="mt-2 text-xs font-semibold text-green-700">Aucun frais de livraison.</p>
                </div>
              </div>
            </section>
          ) : (
            <section ref={addressSectionRef} className="scroll-mb-48 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${quoteToken && hasCompleteAddress ? 'bg-green-600 text-white' : 'bg-[var(--color-primary)] text-white'}`}>{quoteToken && hasCompleteAddress ? <IconCheck size={15} /> : '2'}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold text-gray-950">Adresse de livraison</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">Elle sert à calculer les frais de livraison avant le paiement.</p>
                </div>
              </div>

              {addressLocked && hasCompleteAddress ? (
                <div className="mt-4 rounded-xl bg-green-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-xs font-bold text-green-800"><IconCheck size={15} /> Adresse validée</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{street} {houseNumber}</p>
                      <p className="text-xs text-gray-600">{postalCode} {city} · {COUNTRIES.find((entry) => entry.value === country)?.label ?? country}</p>
                    </div>
                    <button type="button" onClick={() => { setAddressLocked(false); setSubmitError(null); }} className="shrink-0 text-xs font-semibold text-[var(--color-primary)]">Modifier</button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <select value={country} onChange={(event) => { setSubmitError(null); invalidateQuote(); setCountry(event.target.value); }} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]">
                    {COUNTRIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                  </select>
                  {manualMode ? (
                    <div className="grid grid-cols-2 gap-3">
                      <input value={street} onChange={(event) => { setSubmitError(null); invalidateQuote(); setStreet(event.target.value); }} placeholder="Rue" className="col-span-2 rounded-xl border border-gray-200 px-3 py-3 text-sm" />
                      <input value={houseNumber} onChange={(event) => { setSubmitError(null); invalidateQuote(); setHouseNumber(event.target.value); }} placeholder="Numéro" className="rounded-xl border border-gray-200 px-3 py-3 text-sm" />
                      <input value={postalCode} onChange={(event) => { setSubmitError(null); invalidateQuote(); setPostalCode(event.target.value); }} placeholder="Code postal" className="rounded-xl border border-gray-200 px-3 py-3 text-sm" />
                      <input value={city} onChange={(event) => { setSubmitError(null); invalidateQuote(); setCity(event.target.value); }} placeholder="Ville" className="col-span-2 rounded-xl border border-gray-200 px-3 py-3 text-sm" />
                    </div>
                  ) : (
                    <AddressAutocomplete
                      country={country}
                      placeholder="Saisissez votre adresse complète"
                      onSelect={(result) => {
                        setSubmitError(null);
                        invalidateQuote();
                        setPostalCode(result.postalCode);
                        setStreet(result.street);
                        setHouseNumber(result.houseNumber);
                        setCity(result.city);
                        if (result.postalCode && result.street && result.houseNumber && result.city) setAddressLocked(true);
                      }}
                      onManualFallback={() => { setSubmitError(null); setManualMode(true); }}
                    />
                  )}
                </div>
              )}

              <div className="mt-3 space-y-2">
                {submitError && <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700" role="alert">{submitError}</p>}
                {shippingLoading && <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600" role="status">Calcul de la livraison en cours…</p>}
                {!shippingLoading && shippingError && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">{shippingError}</p>}
                {!shippingLoading && quoteToken && <p className="rounded-xl border border-green-100 bg-green-50 px-3 py-2.5 text-xs font-semibold text-green-800">✓ Livraison disponible · {formatPrice(shippingTotal, tenant.currency)}</p>}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${contactComplete ? 'bg-green-600 text-white' : 'bg-[var(--color-primary)] text-white'}`}>{contactComplete ? <IconCheck size={15} /> : '3'}</span>
              <div>
                <h2 className="text-sm font-bold text-gray-950">Contact</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500">Le téléphone est obligatoire : le transporteur ou la boutique peut vous contacter au sujet de la remise de la commande.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div><input {...register('email')} type="email" inputMode="email" autoComplete="email" placeholder="Email" className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" />{errors.email && <p className="mt-1 text-xs font-medium text-red-600">{errors.email.message}</p>}</div>
              <div className="relative"><IconPhone size={16} className="pointer-events-none absolute left-3 top-3.5 text-gray-400" /><input {...register('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="Téléphone" className="w-full rounded-xl border border-gray-200 py-3 pl-9 pr-3 text-sm" />{errors.phone && <p className="mt-1 text-xs font-medium text-red-600">{errors.phone.message}</p>}</div>
            </div>

            <div className="mt-3">
              {sessionCustomer ? (
                <p className="rounded-xl bg-green-50 px-3 py-2 text-xs font-medium text-green-800">Connecté(e) en tant que {sessionCustomer.email}. Les informations de cette commande restent modifiables.</p>
              ) : showLoginForm ? (
                <OtpLoginForm onAuthenticated={() => { void refreshSessionCustomer(); setShowLoginForm(false); }} />
              ) : (
                <button type="button" onClick={() => setShowLoginForm(true)} className="flex min-h-11 w-full items-center justify-between rounded-xl bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-600">
                  <span className="flex items-center gap-2"><IconUser size={15} /> Déjà client ? Se connecter</span><IconChevronDown size={16} />
                </button>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex justify-between py-1.5 text-sm"><span className="text-gray-500">Sous-total ({itemCount} article{itemCount > 1 ? 's' : ''})</span><span className="font-semibold">{formatPrice(subtotal, tenant.currency)}</span></div>
            <div className="flex justify-between py-1.5 text-sm"><span className="text-gray-500">Livraison</span><span className="font-semibold">{isPickup ? 'Gratuit' : quoteToken ? formatPrice(shippingTotal, tenant.currency) : 'À calculer'}</span></div>
            <div className="mt-2 flex items-end justify-between border-t border-gray-200 pt-3"><span className="font-bold">{isPickup || quoteToken ? 'Total' : 'Total estimé'}</span><span className="text-2xl font-black">{formatPrice(total, tenant.currency)}</span></div>
          </section>

          <button type="button" onClick={handleSubmit(continueFromInformation, focusFirstContactError)} disabled={shippingLoading} className="min-h-12 w-full rounded-2xl px-4 py-3.5 text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
            {shippingLoading ? 'Calcul de la livraison…' : 'Continuer — Paiement'}
          </button>
        </div>
      )}

      {step === 'select-payment' && (
        <div className="space-y-5">
          <button type="button" onClick={() => setStep('shipping')} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500"><IconArrowLeft size={14} /> Modifier la livraison et les coordonnées</button>
          <section>
            <h1 className="text-lg font-bold text-gray-950">Choisissez votre moyen de paiement</h1>
            <div className="mt-3">
              <PaymentOptionList options={[
                {
                  key: 'stripe', selected: paymentMode === 'stripe' && !selectedExternalMethodId,
                  onSelect: () => { setPaymentMode('stripe'); setSelectedExternalMethodId(null); },
                  icon: <IconCreditCard size={16} className="text-white" />, color: 'var(--color-primary)', label: 'Carte bancaire', sub: 'Paiement sécurisé, confirmation immédiate',
                },
                ...buildExternalPaymentOptions(externalPaymentMethods, selectedExternalMethodId, (id) => setSelectedExternalMethodId(id)),
                ...(isPickup ? [{
                  key: 'in_store', selected: paymentMode === 'in_store' && !selectedExternalMethodId,
                  onSelect: () => { setPaymentMode('in_store'); setSelectedExternalMethodId(null); },
                  icon: <IconBuildingStore size={16} className="text-white" />, color: '#8a8578', label: 'Paiement en boutique', sub: 'Paiement sur place lors du retrait',
                }] : []),
              ]} />
              {selectedExternalMethod && <ExternalPaymentNote method={selectedExternalMethod} total={total} currency={tenant.currency} />}
            </div>
          </section>

          {(consentState.showTermsCheckbox || consentState.showMarketingCheckbox) && (
            <section className="space-y-3 border-t border-gray-100 pt-4">
              {consentState.showTermsCheckbox && <label className="flex items-start gap-2 text-xs text-gray-600"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4" /><span>J’accepte les <Link href="/conditions-generales-vente" target="_blank" className="underline">Conditions Générales de Vente</Link> et la <Link href="/politique-confidentialite" target="_blank" className="underline">Politique de confidentialité</Link>.</span></label>}
              {consentState.showMarketingCheckbox && <label className="flex items-start gap-2 text-xs text-gray-600"><input type="checkbox" checked={marketingOptIn} onChange={(event) => setMarketingOptIn(event.target.checked)} className="mt-0.5 h-4 w-4" /><span>{marketingConsentLabel(tenant.name)}</span></label>}
            </section>
          )}

          {submitError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{submitError}</p>}
          <button type="button" onClick={confirmPaymentChoice} disabled={isSubmitting || (consentState.showTermsCheckbox && !termsAccepted)} className="min-h-12 w-full rounded-2xl px-4 py-3.5 text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: paymentCtaColor }}>
            {isSubmitting ? 'Traitement…' : paymentMode === 'stripe' && !selectedExternalMethod ? paymentCtaLabel : `${paymentCtaLabel} — ${formatPrice(total, tenant.currency)}`}
          </button>
        </div>
      )}

      {step === 'payment' && (
        <div className="space-y-4">
          <button type="button" onClick={() => setStep('select-payment')} className="flex items-center gap-1.5 text-xs font-semibold text-gray-500"><IconArrowLeft size={14} /> Modifier le mode de paiement</button>
          <div>
            <h1 className="text-lg font-bold text-gray-950">Paiement par carte bancaire</h1>
            <p className="mt-1 text-xs text-gray-500">Transaction sécurisée par Stripe</p>
          </div>
          {submitError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{submitError}</p>}
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-900"><p className="flex items-start gap-2"><IconLock size={15} className="mt-0.5 shrink-0" /> Ne fermez pas cette fenêtre pendant le paiement. Vous serez redirigé(e) une fois le paiement terminé.</p></div>
          <StripePaymentStep
            module="shop"
            isTest={isE2ETest}
            amount={total}
            currency={tenant.currency}
            color="var(--color-primary)"
            returnUrl={`${window.location.origin}/order-confirmation`}
            referenceId={null}
            payLabel={`Payer ${formatPrice(total, tenant.currency)}`}
            processingLabel="Traitement en cours…"
            billingCountryHint="Si un pays est demandé ci-dessous, indiquez celui associé à votre carte bancaire (facturation), pas votre position actuelle."
            createIntent={createIntent}
            onError={(message) => setSubmitError(message)}
            onSucceeded={(paymentIntentId) => {
              useCartStore.getState().clearCart();
              sessionStorage.removeItem('lepefy-checkout-shipping');
              router.push(`/order-confirmation?payment_intent=${paymentIntentId ?? ''}`);
            }}
          />
        </div>
      )}
    </div>
  );
}
