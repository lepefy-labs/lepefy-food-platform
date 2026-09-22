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
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';
import { canUseNala } from '@/lib/entitlements/tenantEntitlements';
import { canShowPublicReviews } from '@/lib/reviews/publicReviewData';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const [socialLinks, nalaEnabled, reviewsAvailable] = await Promise.all([
    getTenantSocialLinks(tenant.id),
    canUseNala(tenant.id),
    canShowPublicReviews(tenant.id),
  ]);
  const storyEnabled = Boolean(tenant.story_heading && tenant.story_text);

  return (
    <div className="min-h-screen flex flex-col">
      <CartSyncProvider>
      <PWABanner />
      <Suspense fallback={<div className="h-24" />}><Header socialLinks={socialLinks} storyEnabled={storyEnabled} reviewsAvailable={reviewsAvailable} /></Suspense>

      <CheckoutNotificationBarGate />
      <ActiveCheckoutRecovery tenant={tenant} />

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
