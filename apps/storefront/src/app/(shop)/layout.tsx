import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PWABanner } from '@/components/PWABanner';
import { BottomNav } from '@/components/layout/BottomNav';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PWABanner />
      <Header />
      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <Footer />
      <BottomNav />
    </div>
  );
}
