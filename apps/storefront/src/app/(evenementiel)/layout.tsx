import { getTenant } from '@/lib/tenant/getTenant';
import { EventsHeader } from './_components/EventsHeader';
import { EventsFooter } from './_components/EventsFooter';

// Route group DÉDIÉ à la vetrina Événementiel — isolé de (shop), qui rend
// Header boutique + PWABanner + ticker promo + BottomNav + Footer boutique
// dans (shop)/layout.tsx (fichier boutique protégé, non touché). Ici, on
// affiche notre propre chrome (EventsHeader/EventsFooter). app/layout.tsx
// (racine, protégé) continue de s'appliquer normalement au-dessus — il ne
// contient ni Header ni bannière PWA ni ticker, juste les tokens CSS
// tenant + TenantProvider + l'enregistrement (invisible) du service worker.
export default async function EvenementielLayout({ children }: { children: React.ReactNode }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <EventsHeader tenant={tenant} />
      <main className="flex-1 pt-[76px]">{children}</main>
      <EventsFooter tenant={tenant} />
    </div>
  );
}
