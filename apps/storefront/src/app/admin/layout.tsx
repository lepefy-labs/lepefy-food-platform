import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

// Coquille HTML partagée par TOUT /admin/** (y compris /admin/login, avant
// toute session). Reste dynamique par principe (cf. audit Prompt 4) — posé
// ici plutôt que sur chaque page admin individuelle : c'est l'ancêtre commun
// réel, donc l'endroit correct pour ce marqueur.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <style>{`
          :root {
            --color-primary:       ${tenant.primary_color};
            --color-primary-light: ${tenant.accent_light};
            --color-secondary:     ${tenant.secondary_color};
          }
        `}</style>
      </head>
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
