import type { TenantPaymentMethod } from '@lepefy/types';

// Helpers purs (sans React/Next) pour la tuile Apple Pay de /card — testés
// dans tests/unit/applePay.spec.ts.

// Activation côté tenant : une ligne `apple_pay` active avec 'card' dans
// enabled_modules. Indépendante de la ligne `card` (le tenant peut proposer
// Apple Pay sans le formulaire carte).
export function isApplePayEnabledForCard(methods: TenantPaymentMethod[]): boolean {
  return methods.some((m) => m.method === 'apple_pay' && m.active && (m.enabled_modules ?? []).includes('card'));
}

// Support côté appareil : Safari (iOS/macOS) expose ApplePaySession ;
// Android, Chrome desktop et la plupart des navigateurs in-app ne l'exposent
// pas. Le verdict final (carte présente dans le Wallet) est donné plus tard
// par l'Express Checkout Element (onReady), pas ici. L'appelant passe `window`.
export function detectApplePayClientSupport(
  w: { ApplePaySession?: { canMakePayments?: () => boolean } } | undefined,
): boolean {
  try {
    const session = w?.ApplePaySession;
    if (!session || typeof session.canMakePayments !== 'function') return false;
    return session.canMakePayments() === true;
  } catch {
    return false;
  }
}

// Domaine à enregistrer chez Stripe (payment method domain) : hostname du
// domaine canonique du tenant, même priorité que le poster/QR de /card
// (storefront_url > NEXT_PUBLIC_APP_URL). Sans protocole, chemin ni port,
// en minuscules. null si rien d'exploitable : jamais de domaine par défaut.
export function resolveApplePayDomain(storefrontUrl: string | null | undefined, appUrl: string | null | undefined): string | null {
  for (const candidate of [storefrontUrl, appUrl]) {
    const raw = candidate?.trim();
    if (!raw) continue;
    try {
      const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
      if (host && host.includes('.')) return host;
    } catch {
      // candidat invalide : on essaie le suivant
    }
  }
  return null;
}

// Liste réellement affichée dans /card : la tuile apple_pay n'apparaît que si
// le tenant l'a activée pour /card ET que l'appareil la supporte. Utilisée à
// la fois pour le bouton « Voir les moyens de paiement » (masqué si la liste
// visible est vide) et pour la liste elle-même.
export function visibleCardPaymentMethods(
  methods: TenantPaymentMethod[],
  applePayEnabled: boolean,
  applePaySupported: boolean,
): TenantPaymentMethod[] {
  const showApplePay = applePayEnabled && applePaySupported;
  return methods.filter((m) => m.method !== 'apple_pay' || showApplePay);
}
