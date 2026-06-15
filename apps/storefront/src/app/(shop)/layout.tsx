import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PWABanner } from '@/components/PWABanner';
import { BottomNav } from '@/components/layout/BottomNav';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PWABanner />
      <Header />

      {/* Notification bar — spedizione */}
      <div
        className="flex items-center justify-center gap-1.5 h-9 px-4 shrink-0"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
          <path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
          <path d="M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5" />
        </svg>
        <span className="text-white text-[11px] font-medium tracking-wide whitespace-nowrap">
          Livraison en Europe · Frais, surgelés &amp; épicerie fine
        </span>
      </div>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <Footer />
      <BottomNav />
    </div>
  );
}
