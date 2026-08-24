import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PWABanner } from '@/components/PWABanner';
import { BottomNav } from '@/components/layout/BottomNav';
import { CheckoutNotificationBarGate } from '@/components/layout/CheckoutNotificationBarGate';
import { ActiveCheckoutRecovery } from '@/components/checkout-session/ActiveCheckoutRecovery';
import { ChatWidgetGate } from '@/components/chat/ChatWidgetGate';
import { CookieConsentBanner } from '@/components/consent/CookieConsentBanner';
import { CartSyncProvider } from '@/components/cart/CartSyncProvider';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const socialLinks = await getTenantSocialLinks(tenant.id);
  const storyEnabled = Boolean(tenant.story_heading && tenant.story_text);

  return (
    <div className="min-h-screen flex flex-col">
      <CartSyncProvider>
      <PWABanner />
      <Header />

      <CheckoutNotificationBarGate />
      <ActiveCheckoutRecovery tenant={tenant} />

      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <Footer socialLinks={socialLinks} storyEnabled={storyEnabled} />
      <BottomNav />
      <ChatWidgetGate
        enabled={tenant.ai_chatbox_enabled}
        tenantName={tenant.name}
        whatsappNumber={tenant.whatsapp_number ?? null}
      />
      <CookieConsentBanner />
      <CartDrawer />
      </CartSyncProvider>
    </div>
  );
}
