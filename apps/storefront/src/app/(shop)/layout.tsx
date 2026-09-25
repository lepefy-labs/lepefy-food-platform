import { Suspense } from 'react';
import { ShopMain } from '@/components/layout/ShopMain';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PWABanner } from '@/components/PWABanner';
import { BottomNav } from '@/components/layout/BottomNav';
import { CheckoutNotificationBarGate } from '@/components/layout/CheckoutNotificationBarGate';
import { ActiveCheckoutRecovery } from '@/components/checkout-session/ActiveCheckoutRecovery';
import { ChatWidgetGate } from '@/components/chat/ChatWidgetGate';
import { CookieConsentBanner } from '@/components/consent/CookieConsentBanner';
import { CartSyncProvider } from '@/components/cart/CartSyncProvider';
import { AddToCartConfirmation } from '@/components/cart/AddToCartConfirmation';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { getTenant } from '@/lib/tenant/getTenant';
import { getShopShellData } from '@/lib/tenant/getShopShellData';

// Ce layout ne lit ni cookies ni session : tout ce qui dépend du client
// connecté (bandeau d'achat à reprendre, compte, panier) est résolu côté
// client. Sinon chaque page boutique redevient dynamique et l'ISR des fiches
// produit / de /accueil ne sert plus jamais depuis le CDN.
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const { socialLinks, nalaEnabled, reviewsAvailable } = await getShopShellData(tenant.id);
  const storyEnabled = Boolean(tenant.story_heading && tenant.story_text);

  return (
    <div className="min-h-screen flex flex-col">
      <CartSyncProvider>
      <PWABanner />
      <Suspense fallback={<div className="h-24" />}><Header socialLinks={socialLinks} storyEnabled={storyEnabled} reviewsAvailable={reviewsAvailable} /></Suspense>

      <CheckoutNotificationBarGate />
      <ActiveCheckoutRecovery />

      <Suspense fallback={<main className="flex-1 pb-20 md:pb-0">{children}</main>}><ShopMain>{children}</ShopMain></Suspense>
      <Footer socialLinks={socialLinks} storyEnabled={storyEnabled} />
      <Suspense><BottomNav /></Suspense>
      <ChatWidgetGate
        enabled={nalaEnabled}
        tenantName={tenant.name}
        tenantLocales={tenant.locales ?? ['fr']}
        tenantLocale={tenant.locale ?? 'fr'}
        whatsappNumber={tenant.whatsapp_number ?? null}
      />
      <CookieConsentBanner />
      <CartDrawer />
      <Suspense><AddToCartConfirmation /></Suspense>
      </CartSyncProvider>
    </div>
  );
}
