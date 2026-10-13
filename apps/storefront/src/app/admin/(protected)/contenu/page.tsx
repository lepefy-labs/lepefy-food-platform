import Link from 'next/link';
import { IconChevronRight, IconPhoto } from '@tabler/icons-react';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { OriginSection } from './OriginSection';
import { CardHeroSection, type CardHeroSource } from './CardHeroSection';
import { createServiceClient } from '@/lib/supabase/server';
import { readDigitalCardSettings } from '@/lib/card/digitalCardSettings';
import { CARD_HERO_ASSETS, resolveCardHeroImage } from '@/lib/card/cardHero';
import { SettingsIconTile } from '../parametres/_components/SettingsUi';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Editorial storefront content lives here, not in Paramètres (configuration).
export default async function ContenuPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canManageSlides = Boolean(access && canAdmin(access, 'catalog.manage'));

  // Photo de la carte digitale : même résolution que /card (téléversée > URL configurée > asset du tenant > aucune).
  const cardSettings = await readDigitalCardSettings(createServiceClient(), tenant.id).catch(() => null);
  const cardConfig = cardSettings?.status === 'ok' ? cardSettings.config : null;
  const heroImage = resolveCardHeroImage({ slug: tenant.slug, config: cardConfig, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
  const heroSource: CardHeroSource = !heroImage ? 'none'
    : cardConfig?.hero_image_base || cardConfig?.hero_image_url ? 'custom'
    : CARD_HERO_ASSETS[tenant.slug] ? 'default' : 'none';

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <AdminPageHeader title="Contenu public" description="Histoire de la boutique, photo de la carte digitale et contenus éditoriaux affichés sur la vitrine." />

      <OriginSection
        tenantId={tenant.id}
        story_heading={tenant.story_heading}
        story_text={tenant.story_text}
        story_image_url={tenant.story_image_url}
        countries_served={tenant.countries_served}
      />

      <CardHeroSection
        preview={heroImage ? {
          src: heroImage.src,
          srcSet: heroImage.sources?.find((source) => source.type === 'image/webp')?.srcSet,
          position: heroImage.position,
          mobilePosition: heroImage.mobilePosition ?? heroImage.position,
        } : null}
        source={heroSource}
        position={cardConfig?.hero_image_position ?? null}
        readOnly={!(access && canAdmin(access, 'tenant_settings.manage'))}
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
