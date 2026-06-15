import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PWABanner } from '@/components/PWABanner';
import { BottomNav } from '@/components/layout/BottomNav';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PWABanner />
      <Header />

      {/* Notification bar — ticker scorrevole CSS puro */}
      <div
        className="relative overflow-hidden shrink-0"
        style={{ backgroundColor: 'var(--color-primary)', height: '36px' }}
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="rgba(255,255,255,0.85)"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
                style={{ flexShrink: 0 }}
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                <path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
                <path d="M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5" />
              </svg>
              Livraison en Europe
              <span className="lepefy-ticker-sep" />
              Frais, surgelés &amp; épicerie fine
              <span className="lepefy-ticker-sep" />
              Commandez depuis toute l&apos;Europe
              <span className="lepefy-ticker-sep" />
              Produits africains authentiques
            </span>
          ))}
        </div>
        {/* Testo accessibile per screen reader */}
        <span className="sr-only">
          Livraison en Europe — Frais, surgelés et épicerie fine
        </span>
      </div>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <Footer />
      <BottomNav />
    </div>
  );
}
