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
//
// The CSS is passed via dangerouslySetInnerHTML, never as a text child: React
// SSR HTML-escapes text children (`>` -> `&gt;`), but <style> is a raw-text
// element, so the browser kept the literal `&gt;` while the client rendered
// `>`. That mismatch (#425 -> #418 -> #423) forced a client re-render of the
// whole root on every admin page, which then crashed on still-dehydrated
// Suspense boundaries (#329) and delayed hydration by seconds.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const [tenant, platform] = await Promise.all([
    getTenant(slug),
    getPlatformBranding(),
  ]);

  // `<` never appears in valid CSS; escaping it keeps DB-provided colour values
  // from closing the raw <style> element.
  const css = `
        :root {
          --admin-primary: ${platform.primary};
          --admin-primary-hover: ${platform.primaryHover};
          --admin-primary-soft: ${platform.primarySoft};
          --admin-primary-fg: ${platform.primaryForeground};
          --admin-surface: ${platform.surface};
          --admin-surface-subtle: ${platform.surfaceSubtle};
          --admin-page-bg: ${platform.pageBackground};
          --admin-border: ${platform.border};
          --admin-text: #172033;
          --admin-text-muted: #475569;
          --admin-focus: ${platform.primary};
          --admin-info-bg: #EFF6FF;
          --admin-info-fg: #1D4ED8;
          --admin-warning-bg: #FFFBEB;
          --admin-warning-fg: #92400E;
          --admin-danger-bg: #FEF2F2;
          --admin-danger-fg: #B91C1C;
          --admin-success-bg: #ECFDF5;
          --admin-success-fg: #047857;

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
      `.replace(/</g, '\\3C ');

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="min-h-screen bg-[var(--admin-page-bg)] font-[family-name:var(--font-body)] text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        {children}
      </div>
    </>
  );
}
