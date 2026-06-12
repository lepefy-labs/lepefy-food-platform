import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PWABanner } from '@/components/PWABanner';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PWABanner />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
