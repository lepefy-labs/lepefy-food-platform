import Link from 'next/link';
import { IconChevronRight, IconPhoto } from '@tabler/icons-react';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { OriginSection } from './OriginSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Editorial storefront content lives here, not in Paramètres (configuration).
export default async function ContenuPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canManageSlides = Boolean(access && canAdmin(access, 'catalog.manage'));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <AdminPageHeader title="Contenu public" description="Histoire de la boutique et contenus éditoriaux affichés sur la vitrine." />

      <OriginSection
        tenantId={tenant.id}
        story_heading={tenant.story_heading}
        story_text={tenant.story_text}
        story_image_url={tenant.story_image_url}
        countries_served={tenant.countries_served}
      />

      {canManageSlides && <Link href="/admin/accueil-slides" className="flex min-h-16 items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"><IconPhoto size={20} stroke={1.7} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-950 dark:text-gray-100">Slides d’accueil</span>
          <span className="block text-sm text-gray-500 dark:text-gray-400">Bannières du carrousel de la page d’accueil.</span>
        </span>
        <IconChevronRight size={18} aria-hidden="true" className="shrink-0 text-gray-300" />
      </Link>}
    </div>
  );
}
