import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { getPlatformBranding } from '@/lib/admin/platformBranding';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const [tenant, platform] = await Promise.all([
    getTenant(slug),
    getPlatformBranding(),
  ]);

  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <style>{`
          :root {
            --admin-primary: ${platform.primary};
            --admin-primary-hover: ${platform.primaryHover};
            --admin-primary-soft: ${platform.primarySoft};
            --admin-primary-fg: ${platform.primaryForeground};
            --admin-surface: ${platform.surface};
            --admin-surface-subtle: ${platform.surfaceSubtle};
            --admin-page-bg: ${platform.pageBackground};
            --admin-border: ${platform.border};

            /* Existing admin components keep working while progressively
               migrating to explicit --admin-* tokens. */
            --color-primary: ${platform.primary};
            --color-primary-light: ${platform.primarySoft};
            --color-primary-dark: ${platform.primaryForeground};
            --color-secondary: ${platform.primaryHover};

            /* Tenant branding is contextual only inside /admin. */
            --tenant-primary: ${tenant.primary_color};
            --tenant-primary-light: ${tenant.accent_light};
            --tenant-secondary: ${tenant.secondary_color};
          }
        `}</style>
      </head>
      <body className="min-h-screen bg-[var(--admin-page-bg)]">
        {children}
      </body>
    </html>
  );
}
