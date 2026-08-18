import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PWABanner } from '@/components/PWABanner';
import { BottomNav } from '@/components/layout/BottomNav';
import { ChatWidget } from '@/components/chat/ChatWidget';
import { CookieConsentBanner } from '@/components/consent/CookieConsentBanner';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const socialLinks = await getTenantSocialLinks(tenant.id);
  const storyEnabled = Boolean(tenant.story_heading && tenant.story_text);

  return (
    <div className="min-h-screen flex flex-col">
      <PWABanner />
      <Header />

      {/* Notification bar — ticker scorrevole CSS puro.
          Fond volontairement plus sombre que l'hero en dessous (color-mix
          dérivé de --color-primary, jamais un noir fixe — reste correct
          pour n'importe quel tenant). 55% et non 25% : à 25% la teinte se
          lisait comme un noir neutre, perdant tout lien avec le brand. */}
      <div
        className="relative overflow-hidden shrink-0"
        style={{ backgroundColor: 'color-mix(in oklch, var(--color-primary) 55%, black)', height: '36px' }}
      >
        <style>{`
          @keyframes lepefy-ticker {
            0%   { transform: translateX(100vw); }
            100% { transform: translateX(-100%); }
          }
          .lepefy-ticker-track {
            display: inline-flex;
            align-items: center;
            gap: 40px;
            white-space: nowrap;
            animation: lepefy-ticker 28s linear infinite;
            position: absolute;
            top: 50%;
            margin-top: -9px;
            will-change: transform;
          }
          .lepefy-ticker-track:hover {
            animation-play-state: paused;
          }
          .lepefy-ticker-item {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            font-weight: 500;
            color: white;
            letter-spacing: 0.2px;
          }
          .lepefy-ticker-sep {
            display: inline-block;
            width: 3px;
            height: 3px;
            border-radius: 50%;
            background: rgba(255,255,255,0.4);
            flex-shrink: 0;
          }
        `}</style>
        {/* Testo ripetuto 3 volte per loop seamless senza vuoti */}
        <div className="lepefy-ticker-track" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="lepefy-ticker-item">
              🚚 Livraison en Europe
              <span className="lepefy-ticker-sep" />
              ❄️ Frais, surgelés &amp; épicerie fine
              <span className="lepefy-ticker-sep" />
              🌍 Commandez depuis toute l&apos;Europe
              <span className="lepefy-ticker-sep" />
              🌿 Produits africains authentiques
            </span>
          ))}
        </div>
        {/* Testo accessibile per screen reader */}
        <span className="sr-only">
          Livraison en Europe — Frais, surgelés et épicerie fine
        </span>
      </div>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <Footer socialLinks={socialLinks} storyEnabled={storyEnabled} />
      <BottomNav />
      <ChatWidget
        enabled={tenant.ai_chatbox_enabled}
        tenantName={tenant.name}
        whatsappNumber={tenant.whatsapp_number ?? null}
      />
      <CookieConsentBanner />
    </div>
  );
}
