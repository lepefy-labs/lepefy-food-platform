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
  return {
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
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

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
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content={tenant.primary_color ?? '#1D9E75'} />
      </head>
      <body className={`${inter.variable} ${bricolage.variable}`}>
        <TenantProvider tenant={tenant}>{children}</TenantProvider>
        <PWARegister />
      </body>
    </html>
  );
}
