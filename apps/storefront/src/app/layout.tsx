import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { TenantProvider } from '@/providers/TenantProvider';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  return {
    title: { default: tenant.name, template: `%s | ${tenant.name}` },
    description: tenant.tagline ?? undefined,
    appleWebApp: { capable: true, statusBarStyle: 'default', title: tenant.name },
    formatDetection: { telephone: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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
      </head>
      <body>
        <TenantProvider tenant={tenant}>{children}</TenantProvider>
      </body>
    </html>
  );
}
