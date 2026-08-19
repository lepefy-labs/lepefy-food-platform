'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import {
  IconMapPin, IconClock, IconCreditCard, IconBuildingStore, IconChevronDown, IconGift, IconArrowLeft,
} from '@tabler/icons-react';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/utils/format';
import Link from 'next/link';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { OtpLoginForm } from '@/components/auth/OtpLoginForm';
import type { CheckoutConsentState } from '@/lib/legal/resolveCheckoutConsentState';
import { marketingConsentLabel } from '@/lib/legal/consentCopy';
import {
  PaymentOptionList, buildExternalPaymentOptions, ExternalPaymentNote,
  externalPaymentCtaLabel, externalPaymentCtaColor,
} from '@/components/payment/ExternalPaymentMethodPicker';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { CheckoutProgressIndicator } from './CheckoutProgressIndicator';
import { usePaymentRedirectRecovery } from '@/lib/payments/usePaymentRedirectRecovery';
import type { CustomerProfile } from '@/lib/customers/types';
import type { FreeShippingInfo } from '@/lib/shipping/freeShippingInfo';
import type { Tenant, TenantPaymentMethod } from '@lepefy/types';

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
  freeShipping?:   FreeShippingInfo;
  quoteToken:      string | null;
  fulfillmentType: 'delivery' | 'pickup';
  country:         string | null;
  postalCode:      string | null;
  street:          string | null;
  houseNumber:     string | null;
  city:            string | null;
  // Optionnels : absents des objets écrits par CartClient.tsx (qui ne
  // collecte pas les coordonnées) — rétrocompatibilité avec un draft déjà en
  // sessionStorage avant cette modification, jamais un champ requis.
  fullName?:       string;
  email?:          string;
  phone?:          string;
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function CheckoutForm({
  tenant,
  externalPaymentMethods = [],
  consentState,
}: {
  tenant: Tenant;
  externalPaymentMethods?: TenantPaymentMethod[];
  consentState: CheckoutConsentState;
}) {
  const { items, totalPrice, shippingPayload } = useCartStore();
  const router = useRouter();

  const { customer: sessionCustomer, refresh: refreshSessionCustomer } = useSessionCustomer();
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [termsAccepted, setTermsAccepted]   = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  // Trois étapes distinctes, comme le mockup (panier → livraison/coordonnées
  // → paiement) : 'form' = coordonnées + adresse, 'select-payment' = choix du
  // mode de paiement (stripe / lien externe / boutique — jamais mélangé avec
  // l'adresse), 'payment' = Elements Stripe (uniquement si stripe choisi).
  const [shippingInfo, setShippingInfo] = useState<CheckoutShipping | null>(() => readStoredShipping());
  const [step, setStep]                 = useState<'form' | 'select-payment' | 'payment'>('form');
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [paymentMode, setPaymentMode]   = useState<PaymentMode>('stripe');

  usePaymentRedirectRecovery('shop', () => {
    useCartStore.getState().clearCart();
    sessionStorage.removeItem('lepefy-checkout-shipping');
    router.push('/order-confirmation');
  });
  // Décision 6 — disponible en delivery ET pickup : sélectionner un moyen
  // externe prime sur `paymentMode` à la confirmation, quel que soit
  // fulfillmentType.
  const [selectedExternalMethodId, setSelectedExternalMethodId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);

  // Id de la checkout_session Stripe créée au premier clic « Payer » de ce
  // tentat de checkout — réutilisé par createIntent() sur les retries
  // (carte rifiutée, etc.) au lieu d'en recréer une à chaque appel. Reset au
  // démontage du composant (nouveau tentat de checkout = nouvelle session).
  const stripeSessionIdRef       = useRef<string | null>(null);
  const stripeSessionSnapshotRef = useRef<string | null>(null);

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
  const [freeShipping, setFreeShipping]       = useState<FreeShippingInfo>(shippingInfo?.freeShipping ?? null);
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
      firstName:   splitFullName(shippingInfo?.fullName ?? null).firstName,
      lastName:    splitFullName(shippingInfo?.fullName ?? null).lastName,
      email:       shippingInfo?.email ?? '',
      phone:       shippingInfo?.phone ?? '',
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

  // ── Sconto ambassador primo ordine — anteprima uniquement ──────────────────
  // Affichage seul : POST /api/checkout recalcule indépendamment ce même
  // montant server-side (source de vérité pour l'importo réellement débité).
  // Réévaluée à la connexion en cours de checkout (sessionCustomer change) et
  // si le sous-total change (quantité modifiée depuis un autre onglet, etc.).
  const [ambassadorDiscount, setAmbassadorDiscount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/checkout/ambassador-discount', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ subtotal }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setAmbassadorDiscount(typeof data.discount === 'number' ? data.discount : 0);
      } catch {
        // Confort — en cas d'échec, aucune réduction affichée mais le
        // checkout continue normalement (POST /api/checkout est la source
        // de vérité de toute façon).
      }
    })();
    return () => { cancelled = true; };
  }, [subtotal, sessionCustomer?.id]);

  const total = subtotal + effectiveShippingTotal - ambassadorDiscount;

  // ── Recalcul live si le code postal / pays change en checkout ──────────────
  const watchedPostalCode = watch('postal_code');
  const watchedCountry    = watch('country');

  const requoteShipping = useCallback(async (c: string, zip: string) => {
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
        setFreeShipping(data.freeShipping ?? null);
        setQuoteToken(data.quoteToken ?? null);
        setQuotedFor({ country: c, postalCode: zip });
      } else {
        setShippingRecalcError(data.message ?? 'Livraison non disponible pour cette adresse.');
        setFreeShipping(null);
        setQuoteToken(null);
      }
    } catch {
      setShippingRecalcError('Erreur lors du calcul des frais de livraison.');
      setFreeShipping(null);
      setQuoteToken(null);
    } finally {
      setShippingRecalculating(false);
    }
  }, [shippingPayload]);

  useEffect(() => {
    if (fulfillmentType !== 'delivery') return;
    const zip = (watchedPostalCode ?? '').trim();
    const c   = (watchedCountry ?? '').trim();
    if (zip.length < 4 || !c) return;
    if (quotedFor && quotedFor.country === c && quotedFor.postalCode === zip) return;

    if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    recalcDebounceRef.current = setTimeout(() => requoteShipping(c, zip), 800);

    return () => {
      if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    };
  }, [watchedPostalCode, watchedCountry, fulfillmentType, quotedFor, requoteShipping]);

  // ── Ricalcul si le panier a changé (retour du panier, autre onglet) ────────
  // Même approche que CartClient : dépendance = payload sérialisé (valeur
  // stable), jamais l'array `items` brut. Le premier rendu est ignoré (le
  // devis transmis par le panier est déjà à jour pour ce contenu), et on ne
  // re-quote pas si le dernier devis est gratuit pour une raison indépendante
  // du sous-total (forfait/remise à 0 sur le pays).
  const shippingPayloadKey = JSON.stringify(shippingPayload());
  const lastPayloadKeyRef  = useRef(shippingPayloadKey);

  useEffect(() => {
    if (lastPayloadKeyRef.current === shippingPayloadKey) return;
    lastPayloadKeyRef.current = shippingPayloadKey;

    if (fulfillmentType !== 'delivery') return;
    const zip = (watchedPostalCode ?? '').trim();
    const c   = (watchedCountry ?? '').trim();
    if (zip.length < 4 || !c) return;
    if (shippingTotal === 0 && freeShipping !== null && freeShipping.reason !== 'threshold') return;

    if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    recalcDebounceRef.current = setTimeout(() => requoteShipping(c, zip), 800);

    return () => {
      if (recalcDebounceRef.current) clearTimeout(recalcDebounceRef.current);
    };
    // Seule la variation du panier doit déclencher cet effet — les autres
    // valeurs (adresse, dernier devis) ne servent qu'aux guards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingPayloadKey]);

  // ── Autosave contacts + adresse (Task 2) ────────────────────────────────────
  // Réécrit 'lepefy-checkout-shipping' (même clé, même sessionStorage — choix
  // délibéré préservé, cf. contexte du prompt) à chaque frappe utilisateur,
  // débouncé ~500ms, même style que recalcDebounceRef ci-dessus. `type ===
  // 'change'` filtre les mises à jour programmatiques (prefill profil via
  // setValue({shouldDirty:false}), ou readStoredShipping au mount) : on ne
  // persiste que ce que l'utilisateur a réellement modifié, jamais au premier
  // rendu avec les seules valeurs par défaut. Les valeurs de spedizione
  // (recalculées ailleurs dans ce fichier, hors formulaire) sont lues via un
  // ref tenu à jour séparément, pour ne pas resouscrire à chaque recalcul.
  const shippingCalcRef = useRef({ fulfillmentType, shippingTotal, shippingDetails, freeShipping, quoteToken });
  useEffect(() => {
    shippingCalcRef.current = { fulfillmentType, shippingTotal, shippingDetails, freeShipping, quoteToken };
  }, [fulfillmentType, shippingTotal, shippingDetails, freeShipping, quoteToken]);

  const autosaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const subscription = watch((values, { type }) => {
      if (type !== 'change') return;

      if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = setTimeout(() => {
        const calc = shippingCalcRef.current;
        const isDelivery = calc.fulfillmentType === 'delivery';
        sessionStorage.setItem('lepefy-checkout-shipping', JSON.stringify({
          shippingTotal:   isDelivery ? calc.shippingTotal : 0,
          shippingDetails: isDelivery ? calc.shippingDetails : null,
          freeShipping:    isDelivery ? calc.freeShipping : null,
          quoteToken:      isDelivery ? calc.quoteToken : null,
          fulfillmentType: calc.fulfillmentType,
          country:         isDelivery ? values.country ?? null : null,
          postalCode:      isDelivery ? values.postal_code ?? null : null,
          street:          isDelivery ? values.street ?? null : null,
          houseNumber:     isDelivery ? values.houseNumber ?? null : null,
          city:            isDelivery ? values.city ?? null : null,
          fullName:        `${values.firstName ?? ''} ${values.lastName ?? ''}`.trim(),
          email:           values.email ?? '',
          phone:           values.phone ?? '',
        }));
      }, 500);
    });

    return () => {
      subscription.unsubscribe();
      if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
    };
  }, [watch]);

  const isSubmitDisabled =
    isSubmitting ||
    (fulfillmentType === 'delivery' && (shippingRecalculating || quoteToken === null));

  // ── Étape 1 → 2 : validation des coordonnées/adresse uniquement ────────────
  // Aucun appel API ici — le mode de paiement n'est pas encore choisi, donc
  // ni /api/checkout ni /api/checkout/external-link ne peuvent être appelés
  // avant l'étape 'select-payment'.
  const onValidateForm = (data: FormValues) => {
    if (fulfillmentType === 'delivery' && (!data.street || !data.houseNumber || !data.city || !data.postal_code)) {
      setSubmitError('Veuillez compléter votre adresse de livraison.');
      return;
    }
    if (fulfillmentType === 'delivery' && quoteToken === null) {
      setSubmitError('Veuillez corriger votre adresse pour recalculer les frais de livraison.');
      return;
    }
    setSubmitError(null);
    setStep('select-payment');
  };

  // ── Étape 2 : confirmation du mode de paiement choisi ───────────────────────
  // Construit le payload partagé entre external_link, in_store et stripe —
  // identique à avant, seulement extrait pour être réutilisable par
  // createIntent (appelé plus tard, au clic "Payer") sans dupliquer cette
  // logique.
  function buildSharedPayload() {
    const data = getValues();
    const shippingAddress =
      fulfillmentType === 'delivery'
        ? {
            full_name:   `${data.firstName} ${data.lastName}`,
            line1:       `${data.street} ${data.houseNumber}`.trim(),
            city:        data.city,
            postal_code: data.postal_code,
            country:     data.country ?? shippingInfo?.country ?? 'IT',
          }
        : null;

    return {
      items: items.map((i) => ({
        productId:    i.product.id,
        name:         i.product.name,
        price:        i.product.price,
        quantity:     i.quantity,
        storage_type: i.product.storage_type ?? 'dry',
      })),
      shippingAddress,
      fulfillmentType,
      email:           data.email,
      phone:           data.phone ?? null,
      fullName:        `${data.firstName} ${data.lastName}`,
      shippingDetails: isPickup ? null : shippingDetails,
      quoteToken:      isPickup ? null : quoteToken,
      termsAccepted:   consentState.showTermsCheckbox ? termsAccepted : undefined,
      marketingOptIn:  consentState.showMarketingCheckbox ? marketingOptIn : undefined,
    };
  }

  // Business logic identique à l'ancienne branche stripe de /api/checkout —
  // validation stock/prix, création checkout_session + PaymentIntent — seul
  // le moment de l'appel change (clic "Payer" dans StripePaymentStep, plus
  // au clic "Continuer vers le paiement" ici).
  //
  // Retry (carte rifiutée, etc.) : réutilise la checkout_session déjà créée
  // au premier clic via POST /api/checkout-sessions/[id]/create-intent
  // plutôt que d'en créer une nouvelle à chaque tentative — évite les lignes
  // orphelines et les PaymentIntent Stripe multiples pour un seul tentat
  // d'achat. Aucun changement de comportement visible : StripePaymentStep ne
  // sait pas distinguer les deux chemins, le contrat createIntent() reste
  // identique.
  async function createIntent() {
    const sharedPayload = buildSharedPayload();
    // Snapshot des données qui déterminent le contenu de la session — si
    // elles changent entre deux tentatives (ex. panier synchronisé depuis un
    // autre appareil pendant que le client est resté sur cette page), la
    // session réutilisée serait périmée par rapport à ce qui est affiché :
    // on force alors une session fraîche plutôt que de réutiliser des
    // données obsolètes.
    const snapshot = JSON.stringify({ ...sharedPayload, shippingTotal: effectiveShippingTotal });

    if (stripeSessionIdRef.current && stripeSessionSnapshotRef.current !== snapshot) {
      stripeSessionIdRef.current = null;
    }

    if (stripeSessionIdRef.current) {
      const retryRes = await fetch(`/api/checkout-sessions/${stripeSessionIdRef.current}/create-intent`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      });

      if (retryRes.ok) {
        const retryResult = await retryRes.json();
        return { clientSecret: retryResult.clientSecret, reference_id: stripeSessionIdRef.current };
      }

      if (retryRes.status === 404) {
        // Session non résumable (annulée entre-temps depuis un autre
        // appareil via « En attente », ou simplement introuvable) : fallback
        // silencieux vers une nouvelle session ci-dessous, jamais une
        // erreur bloquante pour un cas que le client ne peut pas comprendre.
        stripeSessionIdRef.current = null;
      } else {
        const retryResult = await retryRes.json().catch(() => ({}));
        return { error: retryResult.error ?? 'Une erreur est survenue.' };
      }
    }

    const payload = {
      ...sharedPayload,
      shippingTotal: effectiveShippingTotal,
      paymentMethod: 'stripe' as const,
    };

    const res = await fetch('/api/checkout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const result = await res.json();
    if (!res.ok) return { error: result.error ?? 'Une erreur est survenue.' };

    stripeSessionIdRef.current       = result.sessionId ?? null;
    stripeSessionSnapshotRef.current = snapshot;

    return { clientSecret: result.clientSecret, reference_id: result.sessionId ?? null };
  }

  const handleConfirmPayment = async () => {
    if (consentState.showTermsCheckbox && !termsAccepted) {
      setSubmitError('Merci d\'accepter les Conditions Générales de Vente pour continuer.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const sharedPayload = buildSharedPayload();

      // ── Paiement via lien externe (PayPal/Revolut/autre) ──────────────────
      // Route dédiée : aucune commande créée ici, seulement une demande de
      // paiement en attente (checkout_session external_link).
      if (selectedExternalMethodId) {
        const res = await fetch('/api/checkout/external-link', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...sharedPayload, externalPaymentMethodId: selectedExternalMethodId }),
        });

        const result = await res.json();
        if (!res.ok) {
          setSubmitError(result.error ?? 'Une erreur est survenue.');
          return;
        }

        sessionStorage.setItem('lepefy-pending-payment', JSON.stringify({
          sessionId:   result.sessionId,
          link:        result.link,
          amount:      result.amount,
          currency:    result.currency,
          isPaypal:    result.isPaypal,
          label:       result.label,
          accessToken: result.accessToken,
        }));

        router.push(`/checkout/en-attente?ref=${result.sessionId}`);
        return;
      }

      // ── Retrait en boutique payé sur place : aucun PaymentIntent, la
      // commande est créée directement — flux inchangé, jamais différé. ────
      if (isPickup && paymentMode === 'in_store') {
        const payload = {
          ...sharedPayload,
          shippingTotal: effectiveShippingTotal,
          paymentMethod: 'in_store' as const,
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

        const { clearCart } = useCartStore.getState();
        clearCart();
        sessionStorage.removeItem('lepefy-checkout-shipping');
        router.push(`/order-confirmation?order_id=${result.orderId}`);
        return;
      }

      // ── Paiement Stripe : aucun appel réseau ici (deferred intent
      // creation) — le PaymentIntent n'est créé que dans createIntent, au
      // clic sur "Payer" dans StripePaymentStep. ──────────────────────────
      setShowPaymentStep(true);
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

      <CheckoutProgressIndicator currentStep={step} />

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
          {!isPickup && !shippingRecalculating && freeShipping !== null && (
            <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
              <IconGift size={14} className="flex-shrink-0" />
              <span>
                {freeShipping.reason === 'threshold'
                  ? `🎉 Livraison offerte — votre commande dépasse ${formatPrice(freeShipping.thresholdAmount, tenant.currency)}`
                  : '🎉 Livraison offerte pour ce pays'}
              </span>
            </div>
          )}
          {ambassadorDiscount > 0 && (
            <div className="flex justify-between text-sm text-green-600 font-medium">
              <span>Réduction parrainage</span>
              <span>−{formatPrice(ambassadorDiscount, tenant.currency)}</span>
            </div>
          )}
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
        <form onSubmit={handleSubmit(onValidateForm)} className="space-y-6" noValidate>
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

          {submitError && (
            <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {shippingRecalculating ? 'Recalcul des frais de livraison…' : 'Continuer vers le paiement'}
          </button>
        </form>
      )}

      {/* Step 2: Choix du mode de paiement — jamais mélangé à l'adresse
          (Fix 2) : stripe, external_link (Décision 6 — delivery ET pickup)
          et in_store (pickup uniquement) au même niveau, sous forme de cartes
          sélectionnables, comme le mockup "Checkout boutique". */}
      {step === 'select-payment' && (() => {
        const selectedExternalMethod = externalPaymentMethods.find((pm) => pm.id === selectedExternalMethodId) ?? null;

        const ctaLabel = selectedExternalMethod
          ? externalPaymentCtaLabel(selectedExternalMethod, 'la commande')
          : paymentMode === 'in_store'
            ? 'Confirmer le retrait en boutique'
            : 'Continuer vers le paiement';

        const ctaColor = selectedExternalMethod
          ? externalPaymentCtaColor(selectedExternalMethod)
          : paymentMode === 'in_store'
            ? '#8a8578'
            : 'var(--color-primary)';

        const options = [
          {
            key:      'stripe',
            selected: paymentMode === 'stripe' && !selectedExternalMethodId,
            onSelect: () => { setPaymentMode('stripe'); setSelectedExternalMethodId(null); },
            icon:     <IconCreditCard size={16} stroke={1.8} className="text-white" />,
            color:    'var(--color-primary)',
            label:    'Carte bancaire',
            sub:      'Paiement sécurisé, confirmation immédiate',
          },
          ...buildExternalPaymentOptions(externalPaymentMethods, selectedExternalMethodId, (id) => setSelectedExternalMethodId(id)),
          ...(isPickup ? [{
            key:      'in_store',
            selected: paymentMode === 'in_store' && !selectedExternalMethodId,
            onSelect: () => { setPaymentMode('in_store'); setSelectedExternalMethodId(null); },
            icon:     <IconBuildingStore size={16} stroke={1.8} className="text-white" />,
            color:    '#8a8578',
            label:    'Retrait boutique',
            sub:      'Paiement sur place',
          }] : []),
        ];

        return (
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => setStep('form')}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
            >
              <IconArrowLeft size={14} /> Retour
            </button>

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Mode de paiement</p>
              <PaymentOptionList options={options} />

              {selectedExternalMethod && (
                <ExternalPaymentNote method={selectedExternalMethod} total={total} currency={tenant.currency} />
              )}
            </div>

            {(consentState.showTermsCheckbox || consentState.showMarketingCheckbox) && (
              <div className="space-y-2 border-t border-gray-100 pt-4">
                {consentState.showTermsCheckbox && (
                  <label className="flex items-start gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>
                      J&apos;accepte les{' '}
                      <Link href="/conditions-generales-vente" target="_blank" className="underline">
                        Conditions Générales de Vente
                      </Link>{' '}
                      et la{' '}
                      <Link href="/politique-confidentialite" target="_blank" className="underline">
                        Politique de confidentialité
                      </Link>
                      .
                    </span>
                  </label>
                )}
                {consentState.showMarketingCheckbox && (
                  <label className="flex items-start gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={marketingOptIn}
                      onChange={(e) => setMarketingOptIn(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>{marketingConsentLabel(tenant.name)}</span>
                  </label>
                )}
              </div>
            )}

            {submitError && (
              <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{submitError}</p>
            )}

            <button
              type="button"
              onClick={handleConfirmPayment}
              disabled={isSubmitting || (consentState.showTermsCheckbox && !termsAccepted)}
              className="w-full py-4 rounded-2xl font-bold text-white text-base disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: ctaColor }}
            >
              {isSubmitting
                ? 'Traitement…'
                : paymentMode === 'stripe' && !selectedExternalMethod
                  ? ctaLabel
                  : `${ctaLabel} — ${formatPrice(total, tenant.currency)}`
              }
            </button>
          </div>
        );
      })()}

      {/* Step 3: Stripe Payment */}
      {step === 'payment' && showPaymentStep && (
        <div>
          {submitError && (
            <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3 mb-4">
              {submitError}
            </p>
          )}
          <StripePaymentStep
            module="shop"
            amount={total}
            currency={tenant.currency}
            color="var(--color-primary)"
            returnUrl={`${window.location.origin}/order-confirmation`}
            referenceId={null}
            customerEmail={getValues().email || undefined}
            payLabel={`Payer ${formatPrice(total, tenant.currency)}`}
            processingLabel="Traitement en cours…"
            createIntent={createIntent}
            onError={(msg) => setSubmitError(msg)}
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
