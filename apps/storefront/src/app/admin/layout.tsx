import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { getPlatformBranding } from '@/lib/admin/platformBranding';
import { adminTokensCss } from '@/lib/admin/tokens';
import { SHELL_CSS } from './_components/shell/shellState';

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
        ${adminTokensCss(platform)}
        :root {
          /* Tenant branding is contextual only inside /admin (identity,
             storefront previews); the admin UI uses the --admin-* tokens. */
          --tenant-primary: ${tenant.primary_color};
          --tenant-primary-light: ${tenant.accent_light};
          --tenant-secondary: ${tenant.secondary_color};
        }
        ${SHELL_CSS}
      `.replace(/</g, '\\3C ');

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="min-h-screen bg-a-bg font-sans text-a-text antialiased">
        {children}
      </div>
    </>
  );
}
