import Link from 'next/link';
import { IconChevronRight, IconPhoto } from '@tabler/icons-react';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { OriginSection } from './OriginSection';
import { SettingsIconTile } from '../parametres/_components/SettingsUi';

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

      {canManageSlides && <Link href="/admin/accueil-slides" className="flex min-h-16 items-center gap-4 rounded-2xl border border-a-border bg-a-surface px-5 py-4 hover:border-a-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus">
        <SettingsIconTile icon={IconPhoto} accent="fuchsia" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-a-text">Slides d’accueil</span>
          <span className="block text-sm text-a-text-3">Bannières du carrousel de la page d’accueil.</span>
        </span>
        <IconChevronRight size={18} aria-hidden="true" className="shrink-0 text-a-text-3" />
      </Link>}
    </div>
  );
}
