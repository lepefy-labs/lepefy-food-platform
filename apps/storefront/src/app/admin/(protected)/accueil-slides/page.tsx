import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { HeroSlidesSection } from './HeroSlidesSection';
import type { TenantHeroSlide } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AccueilSlidesPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: slides } = await supabase
    .from('tenant_hero_slides')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });

  return (
    <div className="mx-auto w-full max-w-4xl pb-10">
      <AdminPageHeader
        title="Slides d'accueil"
        description="Gérez les diapositives du carrousel affiché en haut de la boutique. Sans slide active, une slide de secours garantit que la page d'accueil conserve toujours un hero."
        meta={`${(slides ?? []).length} slide${(slides ?? []).length !== 1 ? 's' : ''}`}
      />

      <AdminBlockAccent tone="info">
        <HeroSlidesSection initialSlides={(slides ?? []) as TenantHeroSlide[]} />
      </AdminBlockAccent>
    </div>
  );
}
