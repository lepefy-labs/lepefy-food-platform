'use client';

import { useEffect, useState } from 'react';
import { IconUserPlus } from '@tabler/icons-react';
import type { TenantSocialLink, TenantPaymentMethod } from '@lepefy/types';
import { AddToHomeScreen } from './AddToHomeScreen';
import { CardHero } from './CardHero';
import { CardShowcase, CardShowcaseProvider } from './CardShowcase';
import { CardStoreInfo } from './CardStoreInfo';
import { PaymentMethodsAccordion } from './PaymentMethodsAccordion';
import { CardPaymentResult } from './CardPaymentResult';
import { useCardPaymentReturn } from '@/lib/card/useCardPaymentReturn';
import { useCardHistoryStep } from '@/lib/card/useCardHistoryStep';
import { visibleCardPaymentMethods } from '@/lib/payments/applePay';
import { useApplePaySupport } from '@/lib/payments/useApplePaySupport';
import { cardLandingMethods, cardPaymentTiles } from '@/lib/card/cardPaymentTiles';
import { CARD_PAGE_BACKGROUND, readableForeground } from '@/lib/card/cardTheme';
import type { CardHeroImage } from '@/lib/card/cardHero';
import type { OpeningHours } from '@/lib/card/openingHours';
import type { CardShowcaseProduct } from '@/lib/card/getCardShowcaseProducts';

type Lang = 'fr' | 'it';

const COPY = {
  fr: { addContact: 'Ajouter aux contacts' },
  it: { addContact: 'Aggiungi ai contatti' },
} as const;

interface Props {
  tenant: {
    name: string; tagline: string | null; logo_url: string | null; primary_color: string; secondary_color: string; accent_light: string;
    click_collect_address: string | null; google_maps_url: string | null; click_collect_hours: string | null; click_collect_hours_it: string | null;
    whatsapp_number: string | null; storefront_ready: boolean; currency: string;
    google_review_url: string | null;
    legal_email: string | null;
  };
  socialLinks: TenantSocialLink[];
  paymentMethods: TenantPaymentMethod[];
  applePayEnabled: boolean;
  reviewsEnabled: boolean;
  heroImage: CardHeroImage | null;
  showcaseProducts: CardShowcaseProduct[];
  openingHours: OpeningHours | null;
}

/**
 * /card : landing payment-first (1. payer, 2. découvrir la boutique, 3. infos
 * du commerce). Une tuile de la grille ouvre directement son écran
 * (PaymentMethodsAccordion `initialMethodId` : CardQuickPay → Stripe, ou
 * détail du moyen externe) ; retour après redirection via useCardPaymentReturn.
 */
export function DigitalCard({ tenant, socialLinks, paymentMethods: allCardMethods, applePayEnabled, reviewsEnabled, heroImage, showcaseProducts, openingHours }: Props) {
  // Filtre unique pour la grille et les écrans de paiement : jamais les espèces
  // depuis /card ; si seule la ligne apple_pay existe et que l'appareil ne
  // supporte pas Apple Pay, rien n'est proposé (jamais de page de paiement vide).
  const applePaySupported = useApplePaySupport();
  const paymentMethods = cardLandingMethods(visibleCardPaymentMethods(allCardMethods, applePayEnabled, applePaySupported));
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'fr';
    try { return (localStorage.getItem('lepefy-card-lang') as Lang | null) === 'it' ? 'it' : 'fr'; } catch { return 'fr'; }
  });
  const [inPayment, setInPayment] = useState(false);
  // Moyen choisi sur la landing ; null = écran de choix (réessai après une issue).
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const paymentReturn = useCardPaymentReturn();
  // CTA boutique après paiement : seulement si la boutique est ouverte.
  const shop = tenant.storefront_ready ? { color: tenant.primary_color, foreground: readableForeground(tenant.primary_color) } : null;
  const paymentView = inPayment || paymentReturn.result !== null;
  // Retour système depuis le paiement (ou son issue) : revient à la landing au lieu de quitter /card.
  useCardHistoryStep(paymentView, () => { paymentReturn.clear(); closePayment(); });
  const t = COPY[lang];
  // Langue réelle de la page pour les lecteurs d'écran (le <html> est rendu en fr).
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const contactForeground = readableForeground(tenant.primary_color);

  function changeLang(next: Lang) {
    setLang(next);
    try { localStorage.setItem('lepefy-card-lang', next); } catch { /* stockage indisponible : la langue reste celle de la session */ }
  }

  function openPayment(methodId: string | null) {
    setSelectedMethodId(methodId);
    setInPayment(true);
    window.scrollTo({ top: 0 });
  }

  function closePayment() {
    setInPayment(false);
    setSelectedMethodId(null);
  }

  return (
    <CardShowcaseProvider value={{ products: showcaseProducts, currency: tenant.currency, primaryColor: tenant.primary_color }}>
    <div className="min-h-screen" style={{ backgroundColor: CARD_PAGE_BACKGROUND, fontFamily: 'var(--font-card-body)' }}>
      {paymentView ? (
        <main className="mx-auto w-full max-w-xl px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] sm:pt-8">
          {paymentReturn.result ? (
            <CardPaymentResult
              outcome={paymentReturn.result.outcome}
              receipt={paymentReturn.result.receipt}
              currency={tenant.currency}
              lang={lang}
              tenantName={tenant.name}
              shop={shop}
              onReturnToCard={() => { paymentReturn.clear(); closePayment(); }}
              onRetry={paymentMethods.length > 0 ? () => { paymentReturn.clear(); openPayment(null); } : undefined}
            />
          ) : (
            <PaymentMethodsAccordion
              paymentMethods={paymentMethods}
              initialMethodId={selectedMethodId}
              primaryColor={tenant.primary_color}
              currency={tenant.currency}
              tenantName={tenant.name}
              tenantLogoUrl={tenant.logo_url}
              tenantEmail={tenant.legal_email}
              shop={shop}
              lang={lang}
              onClose={closePayment}
            />
          )}
        </main>
      ) : (
        <>
          {/* Invitation PWA : landing uniquement, jamais par-dessus un écran de paiement. */}
          <AddToHomeScreen lang={lang} tenant={{ name: tenant.name, primary_color: tenant.primary_color }} />
          <main className="mx-auto w-full max-w-6xl pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-12 lg:pt-6">
            <CardHero
              lang={lang}
              onLangChange={changeLang}
              tenant={tenant}
              image={heroImage}
              paymentTiles={cardPaymentTiles(paymentMethods)}
              onSelectMethod={openPayment}
              showShop={tenant.storefront_ready}
            />
            <div className="mt-3 grid gap-4 px-4 sm:gap-5 lg:mt-6 lg:grid-cols-12 lg:items-start lg:gap-6 lg:px-0">
              <div className="lg:col-span-7 lg:col-start-6 lg:row-start-1">
                <CardShowcase
                  lang={lang}
                  products={showcaseProducts}
                  storefrontReady={tenant.storefront_ready}
                  tagline={tenant.tagline}
                  currency={tenant.currency}
                  primaryColor={tenant.primary_color}
                />
              </div>
              <div className="flex flex-col gap-4 sm:gap-5 lg:col-span-5 lg:col-start-1 lg:row-start-1">
                <CardStoreInfo lang={lang} tenant={tenant} socialLinks={socialLinks} reviewsEnabled={reviewsEnabled} openingHours={openingHours} />
              </div>
            </div>
          </main>
          {/* Mobile/tablette : barre fixe sur la landing (jamais sur les écrans de paiement). Desktop : bouton dans « La boutique » (CardStoreInfo). */}
          <div className="fixed inset-x-0 bottom-0 z-50 border-t border-black/5 bg-white/90 px-4 pt-2 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'calc(.5rem + env(safe-area-inset-bottom))' }}>
            <a
              href="/api/card/vcard"
              download
              className="mx-auto flex min-h-[52px] w-full max-w-md items-center justify-center gap-2.5 rounded-2xl px-4 text-base font-extrabold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ backgroundColor: tenant.primary_color, color: contactForeground, '--tw-ring-color': tenant.primary_color, fontFamily: 'var(--font-card-heading)' } as React.CSSProperties}
            >
              <IconUserPlus size={20} aria-hidden="true" />{t.addContact}
            </a>
          </div>
        </>
      )}
    </div>
    </CardShowcaseProvider>
  );
}
