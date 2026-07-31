import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { HeroSlidesSection } from './HeroSlidesSection';
import type { TenantHeroSlide } from '@lepefy/types';

export const dynamic = 'force-dynamic';

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
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Slides d&apos;accueil</h1>
      <p className="text-sm text-gray-500 mb-6">
        Gérez les diapositives du carrousel affiché en haut de la page d&apos;accueil.
        S&apos;il n&apos;y a aucune slide active, une slide de secours générique est
        affichée automatiquement — la boutique n&apos;est jamais sans hero.
      </p>

      <HeroSlidesSection initialSlides={(slides ?? []) as TenantHeroSlide[]} />
    </div>
  );
}
