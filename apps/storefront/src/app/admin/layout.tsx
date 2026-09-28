import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { getPlatformBranding } from '@/lib/admin/platformBranding';
import { ADMIN_DARK_CSS } from './_components/adminDarkTheme';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

// Nested layout: the root layout (app/layout.tsx) already renders <html>,
// <head> and <body>. Rendering them again here produced invalid nested markup
// that broke hydration on every admin page (React #418/#423/#425) and made the
// whole document re-render on the client. The admin tokens are emitted as a
// <style> element in the body; it comes after the root :root block, so the
// platform values still win the cascade.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const [tenant, platform] = await Promise.all([
    getTenant(slug),
    getPlatformBranding(),
  ]);

  return (
    <>
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
        ${ADMIN_DARK_CSS}
      `}</style>
      <div className="min-h-screen bg-[var(--admin-page-bg)] text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        {children}
      </div>
    </>
  );
}
