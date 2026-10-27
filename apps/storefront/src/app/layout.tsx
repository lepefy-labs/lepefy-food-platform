import type { Metadata, Viewport } from 'next';
import { Inter, Bricolage_Grotesque } from 'next/font/google';
import { getDisplayTenant } from '@/lib/tenant/getTenant';
import { toPublicTenant } from '@/lib/tenant/publicTenant';
import { TenantProvider } from '@/providers/TenantProvider';
import { demoAccessMode, isDemoActive } from '@/lib/demo/demoEnvironment';
import { hasDemoAccess } from '@/lib/demo/server/demoContext';
import DemoRibbon from '@/components/demo/DemoRibbon';
import PrivateDemoGate from '@/components/demo/PrivateDemoGate';
import { ProductImageDeliveryProvider } from '@/providers/ProductImageDeliveryProvider';
import { productImageDeliveryEnabled } from '@/lib/images/productImageRollout';
import { PWARegister } from '@/components/PWARegister';
import { buildPwaIconPath, getAppIconRevision } from '@/lib/tenant/appIcon';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// Police "signalétique" de la plateforme — décision de design system, pas de
// tenant : s'applique à tous les tenants au même titre qu'Inter en Fase 1.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getDisplayTenant(slug);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return {
    ...(appUrl ? { metadataBase: new URL(appUrl) } : {}),
    title:           { default: tenant.name, template: `%s | ${tenant.name}` },
    description:     tenant.tagline ?? undefined,
    manifest:        '/manifest.webmanifest',
    // Declared as metadata (not hand-written <head> tags) so /admin can override it with the Lepefy Admin icon.
    icons:           { apple: [{ url: buildPwaIconPath(180, undefined, getAppIconRevision(tenant.app_icon_url)), sizes: '180x180' }] },
    appleWebApp: {
      capable:         true,
      statusBarStyle:  'default',
      title:           tenant.name,
    },
    formatDetection: { telephone: false },
    other: {
      'mobile-web-app-capable': 'yes',
    },
    openGraph: {
      title:       tenant.name,
      description: tenant.tagline ?? undefined,
      images:      [{ url: '/api/og-image', width: 1200, height: 630, alt: tenant.name }],
      type:        'website',
    },
    twitter: {
      card:   'summary_large_image',
      images: ['/api/og-image'],
    },
    // Tenant di test (tenants.is_test, migration 138): mai indicizzato.
    // Ereditato da ogni pagina che non definisce robots.
    ...(tenant.is_test ? { robots: { index: false, follow: false } } : {}),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const tenant = await getDisplayTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return { themeColor: tenant.primary_color ?? '#1D9E75' };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getDisplayTenant(slug);

  // Client Components receive only the explicit public projection: provider
  // credentials, assistant context, billing and internal settings never reach
  // the RSC payload (new tenants columns are private by default).
  const clientTenant = toPublicTenant(tenant);

  // Démo (docs/DEMO_EXPERIENCE.md) : bandeau permanent et, en démo privée, accès
  // par lien signé. Hors démo rien n'est lu : les pages restent statiques.
  const demo = isDemoActive(tenant);
  const demoLocked = demo && demoAccessMode() === 'private' && !hasDemoAccess();

  return (
    // The next/font variable classes must sit on <html>: globals.css declares
    // `--font-body: var(--font-inter), …` on :root, and a custom property that
    // references an undefined variable is invalid at computed-value time. With
    // the classes on <body>, --font-body was empty everywhere and every page
    // (storefront and admin) fell back to the browser serif.
    <html lang={tenant.locale.split('-')[0]} className={`${inter.variable} ${bricolage.variable}`} suppressHydrationWarning>
      <head>
        <style>{`
          :root {
            --color-primary: ${tenant.primary_color};
            --color-primary-light: ${tenant.accent_light};
            --color-secondary: ${tenant.secondary_color};
          }
        `}</style>
      </head>
      <body>
        {demo && !demoLocked && <DemoRibbon />}
        <TenantProvider tenant={clientTenant}>
          <ProductImageDeliveryProvider enabled={productImageDeliveryEnabled(tenant)}>{demoLocked ? <PrivateDemoGate /> : children}</ProductImageDeliveryProvider>
        </TenantProvider>
        <PWARegister />
      </body>
    </html>
  );
}
