import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import LogoutButton from './LogoutButton';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

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
        {/* Admin header */}
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
          {tenant.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-auto object-contain" />
          )}
          <div>
            <span className="font-bold text-gray-900 text-sm">{tenant.name}</span>
            <span className="ml-2 text-xs text-gray-400 font-medium uppercase tracking-wide">
              Administration
            </span>
          </div>
          <div className="ml-auto">
            <LogoutButton />
          </div>
        </header>

        {/* Sidebar + content */}
        <div className="flex min-h-[calc(100vh-57px)]">
          <nav className="w-56 bg-white border-r border-gray-200 px-3 py-4 shrink-0 hidden md:block">
            <a
              href="/admin"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span>📦</span> Commandes
            </a>
          </nav>
          <main className="flex-1 p-6 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
