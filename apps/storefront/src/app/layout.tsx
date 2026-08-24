import type { Metadata } from 'next';
import { Inter, Bricolage_Grotesque } from 'next/font/google';
import { getTenant } from '@/lib/tenant/getTenant';
import { TenantProvider } from '@/providers/TenantProvider';
import { PWARegister } from '@/components/PWARegister';
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
  const tenant = await getTenant(slug);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return {
    ...(appUrl ? { metadataBase: new URL(appUrl) } : {}),
    title:           { default: tenant.name, template: `%s | ${tenant.name}` },
    description:     tenant.tagline ?? undefined,
    manifest:        '/manifest.webmanifest',
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
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  // Client Components need tenant branding/configuration, but they must never
  // receive provider credentials or private assistant instructions. Keep the
  // canonical Tenant type for backwards-compatible consumers while replacing
  // server-only values before React serializes the provider prop.
  const clientTenant = {
    ...tenant,
    packlink_api_key: null,
    chatbox_extra_context: null,
  };

  return (
    <html lang={tenant.locale.split('-')[0]} suppressHydrationWarning>
      <head>
        <style>{`
          :root {
            --color-primary: ${tenant.primary_color};
            --color-primary-light: ${tenant.accent_light};
            --color-secondary: ${tenant.secondary_color};
          }
        `}</style>
        <link rel="apple-touch-icon" href="/api/pwa-icon?size=180" />
        <meta name="theme-color" content={tenant.primary_color ?? '#1D9E75'} />
      </head>
      <body className={`${inter.variable} ${bricolage.variable}`}>
        <TenantProvider tenant={clientTenant}>{children}</TenantProvider>
        <PWARegister />
      </body>
    </html>
  );
}