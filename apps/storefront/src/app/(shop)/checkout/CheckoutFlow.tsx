'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  IconAlertTriangle,
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
import { CustomerAddressForm, addressFieldId } from '@/components/address/CustomerAddressForm';
import { NEW_ADDRESS, SavedAddressPicker, type SavedAddress } from '@/components/address/SavedAddressPicker';
import { OtpLoginForm } from '@/components/auth/OtpLoginForm';
import { ErrorSummary, TextField } from '@/components/ui/form';
import {
  PaymentOptionList,
  buildExternalPaymentOptions,
  ExternalPaymentNote,
  externalPaymentCtaColor,
  externalPaymentCtaLabel,
} from '@/components/payment/ExternalPaymentMethodPicker';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { useHasMounted } from '@/hooks/useHasMounted';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import type { CheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { marketingConsentLabel } from '@/lib/legal/consentCopy';
import { usePaymentRedirectRecovery } from '@/lib/payments/usePaymentRedirectRecovery';
import { buildNalaCheckoutAttributions } from '@/lib/ai/nalaAttributionClient';
import type { CustomerProfile } from '@/lib/customers/types';
import type { FreeShippingInfo } from '@/lib/shipping/freeShippingInfo';
import { formatPrice } from '@/lib/utils/format';
import { useCartStore } from '@/stores/cartStore';
import { useCartPurchaseGate } from '@/lib/cart/useCartPurchaseGate';
import type { PublicTenant, TenantPaymentMethod } from '@lepefy/types';
import { ACTION_COPY, ERROR_COPY, FORM_COPY, SUMMARY_COPY, productsPriceLabel, totalWithPendingShipping } from '@/lib/storefrontCopy/copy';
import { ADDRESS_COPY } from '@/lib/storefrontCopy/addressCopy';
import {
  ADDRESS_FIELD_LABELS,
  ADDRESS_FIELD_ORDER,
  countryLabel,
  defaultDeliveryCountry,
  draftToShippingAddress,
  emptyAddressDraft,
  isValidPostalCode,
  normalizePostalCode,
  shippingAddressToDraft,
  validateAddressDraft,
  type AddressDraft,
  type AddressField,
} from '@/lib/address/addressRules';
import { CheckoutProgressIndicator } from './CheckoutProgressIndicator';
import { CartFulfillmentNotice } from '@/components/cart/CartFulfillmentNotice';

/** Codes serveur du mode de réception (lib/fulfillment/fulfillmentPolicy.ts). */
const FULFILLMENT_ERROR_CODES = new Set(['FULFILLMENT_CONFLICT', 'FULFILLMENT_MODE_NOT_ALLOWED', 'PICKUP_NOT_ENABLED']);

const ADDRESS_ID_PREFIX = 'checkout-adresse';

type Step = 'shipping' | 'select-payment' | 'payment';
type FulfillmentType = 'delivery' | 'pickup';
type PaymentMode = 'stripe' | 'in_store';

const contactSchema = z.object({
  firstName: z.string().trim().min(1, FORM_COPY.firstNameRequired),
  lastName: z.string().trim().min(1, FORM_COPY.lastNameRequired),
  email: z.string().trim().email(FORM_COPY.emailInvalid),
  phone: z.string().trim().min(6, FORM_COPY.phoneRequired),
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
  line2: string;
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
      country: typeof parsed.country === 'string' ? parsed.country : '',
      postalCode: typeof parsed.postalCode === 'string' ? parsed.postalCode : '',
      street: typeof parsed.street === 'string' ? parsed.street : '',
      houseNumber: typeof parsed.houseNumber === 'string' ? parsed.houseNumber : '',
      city: typeof parsed.city === 'string' ? parsed.city : '',
      line2: typeof parsed.line2 === 'string' ? parsed.line2 : '',
      firstName: typeof parsed.firstName === 'string' ? parsed.firstName : (fullName[0] ?? ''),
      lastName: typeof parsed.lastName === 'string' ? parsed.lastName : fullName.slice(1).join(' '),
      email: typeof parsed.email === 'string' ? parsed.email : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
    };
  } catch {
    return null;
  }
}

function savedToDraft(saved: SavedAddress): AddressDraft {
  const draft = shippingAddressToDraft(saved);
  delete draft.fullName;
  return draft;
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])') || target.tagName === 'TEXTAREA');
}

export default function CheckoutFlow({
  tenant,
  externalPaymentMethods = [],
  consentState,
  isE2ETest = false,
}: {
  tenant: PublicTenant;
  externalPaymentMethods?: TenantPaymentMethod[];
  consentState: CheckoutConsentState;
  isE2ETest?: boolean;
}) {
  const router = useRouter();
  const { items, totalPrice, shippingPayload } = useCartStore();
  const hydrated = useHasMounted();
  // Pré-contrôle des minimums et du stock (même moteur que /cart et le
  // serveur) : guide seulement, /api/checkout reste l'autorité.
  const purchaseGate = useCartPurchaseGate(items);
  const purchaseGateRef = useRef(purchaseGate);
  purchaseGateRef.current = purchaseGate;
  const cartIssuesRef = useRef<HTMLDivElement>(null);
  const fulfillmentNoticeRef = useRef<HTMLDivElement>(null);
  // Modes possibles pour ce panier (produits « retrait / livraison uniquement »
  // et retrait de la boutique) : même moteur que le serveur.
  const fulfillmentRules = purchaseGate.fulfillment;
  const initialDraftRef = useRef<CheckoutDraft | null>(null);
  if (initialDraftRef.current === null && typeof window !== 'undefined') initialDraftRef.current = readDraft();
  const initialDraft = initialDraftRef.current;

  const { customer: sessionCustomer, refresh: refreshSessionCustomer } = useSessionCustomer();
  const [step, setStep] = useState<Step>('shipping');
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>(initialDraft?.fulfillmentType ?? 'delivery');
  // Pays proposé par défaut : celui de la boutique s'il est livré, sinon le premier de la liste.
  const defaultCountry = defaultDeliveryCountry(tenant.country);
  const [address, setAddress] = useState<AddressDraft>(() => (initialDraft && initialDraft.fulfillmentType === 'delivery' && initialDraft.street
    ? {
      country: initialDraft.country || defaultCountry, street: initialDraft.street, houseNumber: initialDraft.houseNumber,
      postalCode: initialDraft.postalCode, city: initialDraft.city, line2: initialDraft.line2,
    }
    : emptyAddressDraft(defaultCountry)));
  const { country, postalCode } = address;
  // Adresse déjà confirmée (retour du paiement, rechargement) : résumé compact + « Modifier ».
  const [addressCollapsed, setAddressCollapsed] = useState(Boolean(initialDraft?.quoteToken && initialDraft.street));
  const [addressSubmitted, setAddressSubmitted] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [savedSelection, setSavedSelection] = useState<string>(NEW_ADDRESS);
  const [editingSaved, setEditingSaved] = useState(false);
  const [typing, setTyping] = useState(false);
  const addressSummaryRef = useRef<HTMLDivElement>(null);
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
  const [fulfillmentError, setFulfillmentError] = useState<string | null>(null);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [ambassadorDiscount, setAmbassadorDiscount] = useState(0);
  const recalcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripeSessionIdRef = useRef<string | null>(null);
  const stripeSessionSnapshotRef = useRef<string | null>(null);
  const prefilledForCustomerRef = useRef<string | null>(null);
  const addressRef = useRef(address);
  addressRef.current = address;
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

  // Set once the order exists: the cart is then emptied on purpose and the
  // "empty cart → /cart" guard below must not override the confirmation redirect.
  const checkoutCompletedRef = useRef(false);
  const completeCheckout = useCallback((confirmationUrl: string) => {
    checkoutCompletedRef.current = true;
    useCartStore.getState().clearCart();
    sessionStorage.removeItem('lepefy-checkout-shipping');
    router.push(confirmationUrl);
  }, [router]);

  usePaymentRedirectRecovery('shop', () => completeCheckout('/order-confirmation'));

  // Pendant l'hydratation, le store rend l'état serveur (panier vide) : le
  // garde n'agit qu'ensuite et relit le panier réel, sinon un chargement
  // direct de /checkout renverrait toujours vers /cart.
  useEffect(() => {
    if (!hydrated || checkoutCompletedRef.current) return;
    if (useCartStore.getState().items.length === 0) router.push('/cart');
  }, [hydrated, items.length, router]);

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

        // Adresses enregistrées : choix d'un toucher, l'adresse par défaut
        // présélectionnée. Jamais d'écrasement d'une adresse déjà écrite.
        let saved: SavedAddress[] = [];
        try {
          const addressesResponse = await fetch('/api/customers/me/addresses');
          if (addressesResponse.ok) {
            const data = await addressesResponse.json() as { addresses?: SavedAddress[] };
            saved = Array.isArray(data.addresses) ? data.addresses : [];
          }
        } catch {
          // Liste facultative : le formulaire reste disponible.
        }
        if (saved.length === 0 && profile.defaultAddress) {
          saved = [{
            id: 'default', full_name: profile.defaultAddress.fullName, line1: profile.defaultAddress.line1,
            line2: profile.defaultAddress.line2, city: profile.defaultAddress.city,
            postal_code: profile.defaultAddress.postalCode, country: profile.defaultAddress.country, is_default: true,
          }];
        }
        if (cancelled || saved.length === 0) return;
        setSavedAddresses(saved);
        if (!addressRef.current.street && !addressRef.current.postalCode) {
          const preferred = saved.find((entry) => entry.is_default) ?? saved[0]!;
          setSavedSelection(preferred.id);
          setAddress(savedToDraft(preferred));
        }
      } catch {
        // Profile prefill is optional.
      }
    })();
    return () => { cancelled = true; };
  }, [sessionCustomer, getValues, setValue]);

  const subtotal = totalPrice();
  const isPickup = fulfillmentType === 'pickup';
  const effectiveShippingTotal = isPickup ? 0 : shippingTotal;
  const total = subtotal + effectiveShippingTotal - ambassadorDiscount;
  const shippingKnown = isPickup || Boolean(quoteToken);
  const shippingValue = !shippingKnown
    ? SUMMARY_COPY.shippingAfterAddress
    : effectiveShippingTotal === 0 ? SUMMARY_COPY.shippingFree : formatPrice(effectiveShippingTotal, tenant.currency);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const addressErrors = validateAddressDraft(address);
  const hasCompleteAddress = Object.keys(addressErrors).length === 0;
  const quotePostalCode = normalizePostalCode(country, postalCode);
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
      country: isPickup ? null : address.country,
      postalCode: isPickup ? null : address.postalCode,
      street: isPickup ? null : address.street,
      houseNumber: isPickup ? null : address.houseNumber,
      city: isPickup ? null : address.city,
      line2: isPickup ? null : address.line2,
      fullName: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim(),
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    }));
  }, [address, freeShipping, fulfillmentType, getValues, isPickup, quoteToken, shippingDetails, shippingTotal]);

  // Le devis dépend seulement du pays et du code postal (le jeton serveur y est
  // lié) : il n'est demandé qu'avec un code postal complet pour ce pays.
  const quoteShipping = useCallback(async (destinationCountry: string, zip: string) => {
    if (!isValidPostalCode(destinationCountry, zip)) return;
    setShippingLoading(true);
    setShippingError(null);
    try {
      const response = await fetch('/api/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: shippingPayload(), to: { country: destinationCountry, zip_code: zip } }),
      });
      const data = await response.json();
      if (!response.ok || !data.available) {
        setQuoteToken(null);
        setShippingError(data.message ?? ADDRESS_COPY.deliveryUnavailable);
        return;
      }
      setShippingTotal(data.shippingTotal);
      setShippingDetails(data.shippingDetails ?? null);
      setFreeShipping(data.freeShipping ?? null);
      setQuoteToken(data.quoteToken ?? null);
      setQuotedFor({ country: destinationCountry, postalCode: zip });
    } catch {
      setQuoteToken(null);
      setShippingError(ERROR_COPY.shippingQuoteFailed);
    } finally {
      setShippingLoading(false);
    }
  }, [shippingPayload]);

  useEffect(() => {
    if (fulfillmentType !== 'delivery' || !isValidPostalCode(country, quotePostalCode)) return;
    if (quotedFor?.country === country && quotedFor.postalCode === quotePostalCode) return;
    if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    recalcDebounceRef.current = setTimeout(() => { void quoteShipping(country, quotePostalCode); }, 500);
    return () => { if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current); };
  }, [country, fulfillmentType, quotePostalCode, quoteShipping, quotedFor]);

  function invalidateQuote() {
    setQuoteToken(null);
    setShippingDetails(null);
    setFreeShipping(null);
    setQuotedFor(null);
    setShippingError(null);
  }

  // Le serveur a recalculé des frais différents du devis (tarif remplacé,
  // panier ou adresse modifiés) : nouveau devis + nouvelle confirmation du
  // client, jamais de paiement avec un montant non confirmé.
  function handleShippingRequote(result: { code?: string; error?: string }): boolean {
    if (result.code !== 'SHIPPING_REQUOTE_REQUIRED') return false;
    stripeSessionIdRef.current = null;
    invalidateQuote();
    setStep('shipping');
    setSubmitError(result.error ?? 'Le prix de livraison a changé. Vérifiez le nouveau montant avant de payer.');
    if (!isPickup) void quoteShipping(country, quotePostalCode);
    return true;
  }

  /** Change l'adresse ; le devis n'est invalidé que si le pays ou le code postal change. */
  function changeAddress(next: AddressDraft, changed: AddressField[]) {
    setSubmitError(null);
    if (changed.includes('country') || changed.includes('postalCode')) {
      const before = `${address.country}|${normalizePostalCode(address.country, address.postalCode)}`;
      const after = `${next.country}|${normalizePostalCode(next.country, next.postalCode)}`;
      if (before !== after) invalidateQuote();
    }
    setAddress(next);
  }

  function selectSavedAddress(id: string) {
    setSavedSelection(id);
    setEditingSaved(false);
    setAddressSubmitted(false);
    setSubmitError(null);
    const saved = savedAddresses.find((entry) => entry.id === id);
    changeAddress(saved ? savedToDraft(saved) : emptyAddressDraft(address.country), ['country', 'postalCode', 'street', 'houseNumber', 'city', 'line2']);
  }

  /** Ouvre les champs de l'adresse et amène le client au résumé d'erreurs ou au premier champ. */
  function focusAddressSection(message?: string) {
    if (message) setSubmitError(message);
    setAddressCollapsed(false);
    if (savedSelection !== NEW_ADDRESS && !hasCompleteAddress) setEditingSaved(true);
    // Après le rendu (résumé d'erreurs ou champs rouverts) : on centre la cible
    // elle-même, pour qu'elle ne passe pas sous l'en-tête fixe.
    window.setTimeout(() => {
      const target: HTMLElement | null = addressSummaryRef.current
        ?? addressSectionRef.current?.querySelector<HTMLElement>('input, select') ?? null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    }, 60);
  }

  function changeFulfillment(next: FulfillmentType) {
    setFulfillmentType(next);
    setSubmitError(null);
    setFulfillmentError(null);
    if (next === 'pickup') {
      setQuoteToken(null);
      setShippingError(null);
    } else {
      invalidateQuote();
    }
  }

  // Un seul mode possible (produit « retrait uniquement » ou « livraison
  // uniquement », boutique sans retrait) : il est imposé, y compris sur un
  // brouillon restauré ou après un changement du panier. Le devis de livraison
  // devenu inutile ou périmé est invalidé, le paiement revient à l'étape 1.
  const forcedMode = purchaseGate.checking ? null : fulfillmentRules.forcedMode;
  useEffect(() => {
    if (!forcedMode || forcedMode === fulfillmentType) return;
    changeFulfillment(forcedMode);
    stripeSessionIdRef.current = null;
    setStep('shipping');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedMode, fulfillmentType]);

  /** Le serveur a refusé le mode de réception : on relit les règles et on revient au choix du mode. */
  function handleFulfillmentRejection(result: { code?: string; error?: string }): boolean {
    if (!result.code || !FULFILLMENT_ERROR_CODES.has(result.code)) return false;
    stripeSessionIdRef.current = null;
    setStep('shipping');
    setFulfillmentError(result.error ?? ERROR_COPY.generic);
    purchaseGate.reloadGroups();
    return true;
  }

  function showCartIssues() {
    const target = cartIssuesRef.current ?? fulfillmentNoticeRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus();
  }

  const continueFromInformation = (data: ContactValues) => {
    if (!purchaseGate.canProceed) {
      showCartIssues();
      return;
    }
    if (!fulfillmentRules.allowedModes.includes(fulfillmentType)) {
      fulfillmentNoticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!isPickup && !hasCompleteAddress) {
      setAddressSubmitted(true);
      focusAddressSection();
      return;
    }
    if (!isPickup && !quoteToken) {
      focusAddressSection(shippingError ?? ADDRESS_COPY.quoteLoading);
      return;
    }
    if (!data.firstName || !data.lastName || !data.email || !data.phone) return;
    saveDraft();
    setSubmitError(null);
    setAddressCollapsed(!isPickup);
    setStep('select-payment');
  };

  function focusFirstContactError() {
    // L'adresse est avant le contact dans la page : ses erreurs d'abord.
    if (!isPickup && !hasCompleteAddress) {
      setAddressSubmitted(true);
      focusAddressSection();
      return;
    }
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
      nalaAttributions: buildNalaCheckoutAttributions(items),
      shippingAddress: isPickup ? null : draftToShippingAddress(address, `${data.firstName} ${data.lastName}`),
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
    const gate = purchaseGateRef.current;
    if (!gate.canProceed) return { error: gate.blockedMessage ?? ERROR_COPY.generic };
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
          if (!handleFulfillmentRejection(retryResult)) handleShippingRequote(retryResult);
          return { error: retryResult.error ?? ERROR_COPY.generic };
        }
        stripeSessionIdRef.current = null;
      }

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sharedPayload, shippingTotal: effectiveShippingTotal, paymentMethod: 'stripe' as const }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (!handleFulfillmentRejection(result)) handleShippingRequote(result);
        return { error: result.error ?? ERROR_COPY.generic };
      }
      stripeSessionIdRef.current = result.sessionId ?? null;
      stripeSessionSnapshotRef.current = snapshot;
      return { clientSecret: result.clientSecret, reference_id: result.sessionId ?? null };
    } catch {
      return { error: ERROR_COPY.generic };
    }
  }

  async function confirmPaymentChoice() {
    if (!purchaseGate.canProceed) {
      showCartIssues();
      return;
    }
    if (consentState.showTermsCheckbox && !termsAccepted) {
      setSubmitError(ERROR_COPY.termsRequired);
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
        if (!response.ok) {
          if (!handleFulfillmentRejection(result) && !handleShippingRequote(result)) setSubmitError(result.error ?? ERROR_COPY.generic);
          return;
        }
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
        if (!response.ok) { if (!handleFulfillmentRejection(result)) setSubmitError(result.error ?? ERROR_COPY.generic); return; }
        completeCheckout(`/order-confirmation?order_id=${result.orderId}`);
        return;
      }

      saveDraft();
      setStep('payment');
    } catch {
      setSubmitError(ERROR_COPY.generic);
    } finally {
      setIsSubmitting(false);
    }
  }

  const compactSummary = (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <button type="button" onClick={() => setShowOrderDetails((value) => !value)} className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left">
        <span>
          <span className="block text-xs font-medium text-gray-600">{SUMMARY_COPY.totalToPay}</span>
          <span className="text-lg font-black text-gray-950">{shippingKnown ? formatPrice(total, tenant.currency) : totalWithPendingShipping(subtotal - ambassadorDiscount, tenant.currency)}</span>
          <span className="ml-2 text-xs text-gray-600">· {itemCount} article{itemCount > 1 ? 's' : ''}</span>
        </span>
        <IconChevronDown size={18} className={`text-gray-500 transition-transform ${showOrderDetails ? 'rotate-180' : ''}`} />
      </button>
      {showOrderDetails && (
        <div className="border-t border-gray-100 px-4 py-3 text-sm">
          {items.map((item) => (
            <div key={item.product.id} className="flex justify-between gap-4 py-1.5"><span className="min-w-0 truncate text-gray-600">{item.quantity}× {item.product.name}</span><span className="font-medium">{formatPrice(item.product.price * item.quantity, tenant.currency)}</span></div>
          ))}
          <div className="mt-2 flex justify-between border-t border-gray-100 pt-2"><span className="text-gray-600">{SUMMARY_COPY.shippingPrice}</span><span className="font-semibold">{shippingValue}</span></div>
          {ambassadorDiscount > 0 && <div className="flex justify-between py-1.5 text-green-700"><span>Avantage ambassadeur</span><span>-{formatPrice(ambassadorDiscount, tenant.currency)}</span></div>}
        </div>
      )}
    </section>
  );

  if (!hydrated || items.length === 0) return null;

  const fullSummary = (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-label="Montant de la commande">
      <div className="flex justify-between py-1.5 text-sm"><span className="text-gray-700">{productsPriceLabel(itemCount)}</span><span className="font-semibold">{formatPrice(subtotal, tenant.currency)}</span></div>
      <div className="flex justify-between py-1.5 text-sm"><span className="text-gray-700">{SUMMARY_COPY.shippingPrice}</span><span className="font-semibold">{shippingValue}</span></div>
      {ambassadorDiscount > 0 && <div className="flex justify-between py-1.5 text-sm text-green-700"><span>Avantage ambassadeur</span><span>-{formatPrice(ambassadorDiscount, tenant.currency)}</span></div>}
      <div className="mt-2 flex items-end justify-between gap-3 border-t border-gray-200 pt-3">
        <span>
          <span className="block font-bold">{SUMMARY_COPY.totalToPay}</span>
          <span className="block text-xs text-gray-600">{SUMMARY_COPY.taxIncluded}</span>
        </span>
        <span className="text-right text-2xl font-black tabular-nums" aria-live="polite">{shippingKnown ? formatPrice(total, tenant.currency) : totalWithPendingShipping(subtotal - ambassadorDiscount, tenant.currency)}</span>
      </div>
    </section>
  );

  const selectedExternalMethod = externalPaymentMethods.find((method) => method.id === selectedExternalMethodId) ?? null;
  const paymentCtaLabel = selectedExternalMethod
    ? externalPaymentCtaLabel(selectedExternalMethod, 'la commande')
    : paymentMode === 'in_store' ? ACTION_COPY.orderPayAtPickup : 'Payer par carte';
  const paymentCtaColor = selectedExternalMethod ? externalPaymentCtaColor(selectedExternalMethod) : paymentMode === 'in_store' ? '#8a8578' : 'var(--color-primary)';

  const addressSummaryItems = addressSubmitted && !isPickup
    ? ADDRESS_FIELD_ORDER.filter((field) => addressErrors[field])
      .map((field) => ({ fieldId: addressFieldId(ADDRESS_ID_PREFIX, field), label: ADDRESS_FIELD_LABELS[field] }))
    : [];
  const showAddressForm = savedAddresses.length === 0 || savedSelection === NEW_ADDRESS || editingSaved;
  const showAddressSummary = addressCollapsed && hasCompleteAddress && Boolean(quoteToken);

  return (
    <div
      data-typing={typing ? 'true' : undefined}
      onFocusCapture={(event) => setTyping(isTextEntry(event.target))}
      onBlurCapture={() => setTyping(false)}
      className={`mx-auto w-full px-4 py-4 pb-10 sm:px-6 sm:py-7 ${step === 'shipping' ? 'max-w-2xl lg:max-w-5xl' : 'max-w-2xl'}`}
    >
      <CheckoutProgressIndicator currentStep={step} />
      <div data-checkout-sticky="summary" className={`mb-5 ${step === 'shipping' ? 'lg:hidden' : ''}`}>{compactSummary}</div>

      {!purchaseGate.checking && (purchaseGate.error || purchaseGate.issues.length > 0) && (
        <div ref={cartIssuesRef} tabIndex={-1} role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          <p className="flex items-start gap-2 font-bold">
            <IconAlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            {purchaseGate.error ? purchaseGate.error : "Votre panier n'est pas encore complet."}
          </p>
          {!purchaseGate.error && (
            <ul className="mt-1.5 space-y-1 pl-6">
              {purchaseGate.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 pl-6">
            {purchaseGate.error && (
              <button type="button" onClick={purchaseGate.reloadGroups} className="min-h-11 font-bold underline">{ACTION_COPY.retry}</button>
            )}
            <Link href="/cart" className="inline-flex min-h-11 items-center font-bold underline">Modifier mon panier</Link>
          </div>
        </div>
      )}

      {step === 'shipping' && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
        <div className="space-y-5">
          <section className="rounded-2xl bg-[color-mix(in_srgb,var(--color-primary)_6%,white)] px-4 py-3.5">
            <p className="text-sm font-bold text-gray-950">{isPickup ? 'Retrait en boutique' : 'Livraison chez vous'}</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">
              {isPickup ? 'Écrivez votre nom, votre e-mail et votre téléphone.' : 'Écrivez votre nom, votre adresse, votre e-mail et votre téléphone.'}
            </p>
          </section>

          <section>
            <h1 className="text-lg font-bold text-gray-950">Comment recevoir votre commande ?</h1>
            {!purchaseGate.checking && (
              <CartFulfillmentNotice ref={fulfillmentNoticeRef} eligibility={fulfillmentRules} pickupAvailable={Boolean(tenant.click_collect_enabled)} className="mt-3" />
            )}
            {fulfillmentError && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800" role="alert">{fulfillmentError}</p>}
            <div className={`mt-3 grid gap-3 ${fulfillmentRules.allowedModes.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {(['delivery', 'pickup'] as const).filter((type) => fulfillmentRules.allowedModes.includes(type)).map((type) => {
                const active = fulfillmentType === type;
                return (
                  <button key={type} type="button" aria-pressed={active} onClick={() => changeFulfillment(type)} className={`relative min-h-[92px] rounded-2xl border-[1.5px] p-4 text-left transition-colors ${active ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_5%,white)]' : 'border-[color:var(--field-border)] bg-white'}`}>
                    <span className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl ${active ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 text-gray-600'}`}>{type === 'delivery' ? <IconTruck size={18} aria-hidden="true" /> : <IconBuildingStore size={18} aria-hidden="true" />}</span>
                    <span className="block text-sm font-bold text-gray-950">{type === 'delivery' ? 'Livraison' : 'Retrait en boutique'}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-gray-700">{type === 'delivery' ? 'Chez vous, à votre adresse' : 'Vous venez la chercher, sans prix de livraison'}</span>
                    {active && <IconCheck size={16} className="absolute right-3 top-3 text-[var(--color-primary)]" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${recipientComplete ? 'bg-green-600 text-white' : 'bg-[var(--color-primary)] text-white'}`} aria-hidden="true">{recipientComplete ? <IconCheck size={15} /> : '1'}</span>
              <div>
                <h2 className="text-base font-bold text-gray-950">{isPickup ? 'Qui vient chercher la commande ?' : 'À quel nom livrer ?'}</h2>
                <p className="mt-0.5 text-sm text-gray-700">Prénom et nom de la personne qui reçoit la commande.</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <TextField {...register('firstName')} label="Prénom" autoComplete="given-name" placeholder="Ex. : Marie" enterKeyHint="next" error={errors.firstName?.message} />
              <TextField {...register('lastName')} label="Nom" autoComplete="family-name" placeholder="Ex. : Kamga" enterKeyHint="next" error={errors.lastName?.message} />
            </div>
          </section>

          {isPickup ? (
            <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-white" aria-hidden="true"><IconCheck size={15} /></span>
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold text-blue-900"><IconMapPin size={17} aria-hidden="true" /> Retrait chez {tenant.name}</p>
                  {tenant.click_collect_address && <p className="mt-2 text-sm text-blue-800">{tenant.click_collect_address}</p>}
                  <p className="mt-2 text-sm font-semibold text-green-800">Pas de prix de livraison.</p>
                </div>
              </div>
            </section>
          ) : (
            <section ref={addressSectionRef} aria-labelledby="checkout-address-title" className="scroll-mt-24 scroll-mb-48 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${quoteToken && hasCompleteAddress ? 'bg-green-600 text-white' : 'bg-[var(--color-primary)] text-white'}`} aria-hidden="true">{quoteToken && hasCompleteAddress ? <IconCheck size={15} /> : '2'}</span>
                <div className="min-w-0 flex-1">
                  <h2 id="checkout-address-title" className="text-base font-bold text-gray-950">{ADDRESS_COPY.title}</h2>
                  <p className="mt-0.5 text-sm leading-relaxed text-gray-700">
                    {savedAddresses.length > 0 && !showAddressSummary ? ADDRESS_COPY.chooseSaved : ADDRESS_COPY.allRequired}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-4">
                {showAddressSummary ? (
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 p-3.5">
                    <div className="min-w-0 text-[15px] leading-snug text-gray-950">
                      <p className="font-semibold">{draftToShippingAddress(address, '').line1}</p>
                      {address.line2.trim() && <p className="text-sm text-gray-700">{address.line2}</p>}
                      <p className="text-sm text-gray-700">{quotePostalCode} {address.city} · {countryLabel(address.country)}</p>
                    </div>
                    <button type="button" onClick={() => { setAddressCollapsed(false); setSubmitError(null); }}
                      className="min-h-11 shrink-0 px-1 text-sm font-bold text-[color:var(--color-primary-dark)] underline underline-offset-4">
                      {ADDRESS_COPY.edit}
                    </button>
                  </div>
                ) : (
                  <>
                    {savedAddresses.length > 0 && (
                      <SavedAddressPicker
                        name="checkout-saved-address"
                        addresses={savedAddresses}
                        selected={savedSelection}
                        onSelect={selectSavedAddress}
                        onEdit={() => setEditingSaved(true)}
                      />
                    )}
                    {showAddressForm && (
                      <>
                        <ErrorSummary ref={addressSummaryRef} items={addressSummaryItems} />
                        <CustomerAddressForm
                          idPrefix={ADDRESS_ID_PREFIX}
                          value={address}
                          onChange={changeAddress}
                          showAllErrors={addressSubmitted}
                          searchMode={editingSaved ? 'collapsed' : 'open'}
                          autofillSection="shipping"
                        />
                      </>
                    )}
                  </>
                )}

                <div className="space-y-2" aria-live="polite">
                  {submitError && <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800" role="alert">{submitError}</p>}
                  {shippingLoading && (
                    <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm font-semibold text-gray-800" role="status">
                      <span className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-300 motion-safe:animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} aria-hidden="true" />
                      {ADDRESS_COPY.quoteLoading}
                    </p>
                  )}
                  {!shippingLoading && shippingError && (
                    <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800" role="alert">
                      <IconAlertTriangle size={18} className="mt-px shrink-0" aria-hidden="true" />{shippingError}
                    </p>
                  )}
                  {!shippingLoading && quoteToken && (
                    <p className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-900">
                      <IconCheck size={18} className="mt-px shrink-0" aria-hidden="true" />
                      <span><span className="font-bold">{hasCompleteAddress ? ADDRESS_COPY.deliveryAvailable : ADDRESS_COPY.deliveryAvailablePostalCode}</span>{' '}{ADDRESS_COPY.deliveryPriceLabel} {shippingTotal === 0 ? SUMMARY_COPY.shippingFree.toLowerCase() : formatPrice(shippingTotal, tenant.currency)}</span>
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${contactComplete ? 'bg-green-600 text-white' : 'bg-[var(--color-primary)] text-white'}`} aria-hidden="true">{contactComplete ? <IconCheck size={15} /> : isPickup ? '2' : '3'}</span>
              <div>
                <h2 className="text-base font-bold text-gray-950">Contact</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-gray-700">Le téléphone est obligatoire : le livreur ou la boutique peut vous appeler pour la remise.</p>
              </div>
            </div>
            <div className="mt-4 space-y-4">
              <TextField {...register('email')} label="E-mail" type="email" inputMode="email" autoComplete="email" placeholder="Ex. : nom@gmail.com" enterKeyHint="next" error={errors.email?.message} />
              <TextField {...register('phone')} label="Téléphone" type="tel" inputMode="tel" autoComplete="tel" placeholder="Ex. : +39 351 234 5678" hint="Avec l'indicatif du pays." enterKeyHint="done"
                leading={<IconPhone size={18} />} error={errors.phone?.message} />
            </div>

            <div className="mt-4">
              {sessionCustomer ? (
                <p className="rounded-xl bg-green-50 px-3.5 py-2.5 text-sm font-medium text-green-900">Connecté(e) en tant que {sessionCustomer.email}. Les informations de cette commande restent modifiables.</p>
              ) : showLoginForm ? (
                <OtpLoginForm onAuthenticated={() => { void refreshSessionCustomer(); setShowLoginForm(false); }} />
              ) : (
                <button type="button" onClick={() => setShowLoginForm(true)} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-800">
                  <span className="flex items-center gap-2"><IconUser size={17} aria-hidden="true" /> Déjà client ? Se connecter</span><IconChevronDown size={17} aria-hidden="true" />
                </button>
              )}
            </div>
          </section>
        </div>

        <aside className="mt-5 space-y-4 lg:sticky lg:top-24 lg:mt-0">
          {fullSummary}

          <button type="button" data-checkout-sticky="cta" onClick={handleSubmit(continueFromInformation, focusFirstContactError)} disabled={shippingLoading || !purchaseGate.canProceed} className="min-h-12 w-full rounded-2xl px-4 py-3.5 text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
            {shippingLoading ? 'Calcul du prix de livraison…' : ACTION_COPY.choosePayment}
          </button>
        </aside>
        </div>
      )}

      {step === 'select-payment' && (
        <div className="space-y-5">
          <button type="button" onClick={() => setStep('shipping')} className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gray-700"><IconArrowLeft size={14} aria-hidden="true" /> Modifier l&apos;adresse ou le contact</button>
          <section>
            <h1 className="text-lg font-bold text-gray-950">Comment voulez-vous payer ?</h1>
            <div className="mt-3">
              <PaymentOptionList options={[
                {
                  key: 'stripe', selected: paymentMode === 'stripe' && !selectedExternalMethodId,
                  onSelect: () => { setPaymentMode('stripe'); setSelectedExternalMethodId(null); },
                  icon: <IconCreditCard size={16} className="text-white" />, color: 'var(--color-primary)', label: 'Carte bancaire', sub: 'Paiement sécurisé. Commande confirmée tout de suite.',
                },
                ...buildExternalPaymentOptions(externalPaymentMethods, selectedExternalMethodId, (id) => setSelectedExternalMethodId(id)),
                ...(isPickup ? [{
                  key: 'in_store', selected: paymentMode === 'in_store' && !selectedExternalMethodId,
                  onSelect: () => { setPaymentMode('in_store'); setSelectedExternalMethodId(null); },
                  icon: <IconBuildingStore size={16} className="text-white" />, color: '#8a8578', label: 'Payer au retrait', sub: 'Vous payez en boutique en venant chercher la commande',
                }] : []),
              ]} />
              {selectedExternalMethod && <ExternalPaymentNote method={selectedExternalMethod} total={total} currency={tenant.currency} />}
            </div>
          </section>

          {(consentState.showTermsCheckbox || consentState.showMarketingCheckbox) && (
            <section className="space-y-3 border-t border-gray-100 pt-4">
              {consentState.showTermsCheckbox && <label className="flex min-h-11 items-start gap-3 text-sm text-gray-800"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="sf-checkbox mt-0.5" /><span>J’accepte les <Link href="/conditions-generales-vente" target="_blank" className="underline">Conditions Générales de Vente</Link> et la <Link href="/politique-confidentialite" target="_blank" className="underline">Politique de confidentialité</Link>.</span></label>}
              {consentState.showMarketingCheckbox && <label className="flex min-h-11 items-start gap-3 text-sm text-gray-800"><input type="checkbox" checked={marketingOptIn} onChange={(event) => setMarketingOptIn(event.target.checked)} className="sf-checkbox mt-0.5" /><span>{marketingConsentLabel(tenant.name)}</span></label>}
            </section>
          )}

          {fullSummary}

          {submitError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{submitError}</p>}
          <button type="button" data-checkout-sticky="cta" onClick={confirmPaymentChoice} disabled={isSubmitting || !purchaseGate.canProceed || (consentState.showTermsCheckbox && !termsAccepted)} className="min-h-12 w-full rounded-2xl px-4 py-3.5 text-base font-bold text-white disabled:opacity-50" style={{ backgroundColor: paymentCtaColor }}>
            {isSubmitting ? ACTION_COPY.processing : `${paymentCtaLabel} · ${formatPrice(total, tenant.currency)}`}
          </button>
        </div>
      )}

      {step === 'payment' && (
        <div className="space-y-4">
          <button type="button" onClick={() => setStep('select-payment')} className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gray-700"><IconArrowLeft size={14} aria-hidden="true" /> Choisir un autre paiement</button>
          <div>
            <h1 className="text-lg font-bold text-gray-950">Paiement par carte bancaire</h1>
            <p className="mt-1 text-xs text-gray-600">Paiement sécurisé par Stripe</p>
          </div>
          {submitError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{submitError}</p>}
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900"><p className="flex items-start gap-2"><IconLock size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> Restez sur cette page pendant le paiement.</p></div>
          <StripePaymentStep
            module="shop"
            isTest={isE2ETest}
            amount={total}
            currency={tenant.currency}
            color="var(--color-primary)"
            returnUrl={`${window.location.origin}/order-confirmation`}
            referenceId={null}
            payLabel={`${ACTION_COPY.orderAndPay} · ${formatPrice(total, tenant.currency)}`}
            processingLabel="Paiement en cours…"
            billingCountryHint="Pays : indiquez celui de votre carte bancaire."
            createIntent={createIntent}
            onError={(message) => setSubmitError(message)}
            onSucceeded={(paymentIntentId) => completeCheckout(`/order-confirmation?payment_intent=${paymentIntentId ?? ''}`)}
          />
        </div>
      )}
    </div>
  );
}
