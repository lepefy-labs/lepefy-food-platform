import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import {
  IconArrowDown,
  IconCalendarEvent,
  IconChefHat,
  IconLeaf,
  IconSparkles,
  IconUsers,
} from '@tabler/icons-react';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import DevisForm from './DevisForm';
import RentalCheckoutClient from './RentalCheckoutClient';
import type { ServiceOffering, RentalItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createPublicClient();
  const { data: offering } = await supabase
    .from('service_offerings')
    .select('title')
    .eq('tenant_id', tenant.id)
    .eq('slug', params.slug)
    .eq('active', true)
    .maybeSingle();

  return { title: offering?.title ?? 'Service' };
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.services_enabled) notFound();

  const supabase = createPublicClient();
  const { data: offering } = await supabase
    .from('service_offerings')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('slug', params.slug)
    .eq('active', true)
    .maybeSingle();

  if (!offering) notFound();
  const serviceOffering = offering as ServiceOffering;

  let rentalItems: RentalItem[] = [];
  if (serviceOffering.cta_type === 'reservation') {
    const { data } = await supabase
      .from('rental_items')
      .select('*')
      .eq('service_offering_id', serviceOffering.id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    rentalItems = (data ?? []) as RentalItem[];
  }

  const allPaymentMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allPaymentMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('rental'),
  );

  if (serviceOffering.cta_type === 'devis') {
    return (
      <div className="bg-[#f7f3eb] text-[#20231f]">
        <section className="relative isolate min-h-[430px] overflow-hidden sm:min-h-[500px]">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: serviceOffering.cover_image_url ? `url(${serviceOffering.cover_image_url})` : undefined,
              backgroundColor: serviceOffering.cover_image_url ? undefined : 'var(--color-primary-dark)',
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,27,16,.9),rgba(8,27,16,.56),rgba(8,27,16,.12))]" />
          <div className="relative mx-auto flex min-h-[430px] max-w-[1180px] items-center px-4 py-14 sm:min-h-[500px] sm:px-6">
            <div className="max-w-[620px] text-white">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-secondary)]">Service traiteur</p>
              <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.02] sm:text-6xl">Votre événement,<br />notre cuisine.</h1>
              {serviceOffering.description && (
                <p className="mt-5 max-w-xl whitespace-pre-line text-base leading-relaxed text-white/80 sm:text-lg">{serviceOffering.description}</p>
              )}
              <a href="#devis" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-secondary)] px-5 text-sm font-bold text-[var(--color-primary-dark)] shadow-lg">
                Demander un devis <IconArrowDown size={17} />
              </a>
            </div>
          </div>
        </section>

        <main className="mx-auto max-w-[1180px] px-4 py-12 sm:px-6 sm:py-16">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [IconUsers, 'Sur mesure', 'Une proposition adaptée au format et aux besoins de votre événement.'],
              [IconLeaf, 'Produits frais', 'Une approche simple et soignée, pensée autour du plaisir de recevoir.'],
              [IconSparkles, 'Service soigné', 'Une expérience claire, de la demande initiale jusqu’au jour J.'],
              [IconCalendarEvent, 'Privé & professionnel', 'Des formats flexibles pour vos réceptions et événements.'],
            ].map(([Icon, title, text]) => (
              <div key={String(title)} className="rounded-3xl border border-black/[0.06] bg-white p-5 shadow-sm">
                <Icon size={24} className="text-[var(--color-primary)]" />
                <h2 className="mt-4 font-display text-xl font-semibold">{String(title)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{String(text)}</p>
              </div>
            ))}
          </section>

          <section className="py-14 sm:py-18">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Simple & clair</p>
            <h2 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">Comment ça marche</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {[
                ['01', 'Échangeons', 'Partagez votre date, votre format et vos besoins.'],
                ['02', 'Nous proposons', 'Nous préparons une réponse adaptée à votre projet.'],
                ['03', 'Nous réalisons', 'Une fois validé, nous organisons la prestation avec vous.'],
              ].map(([number, title, text]) => (
                <div key={number} className="relative rounded-3xl bg-[#efe5d1] p-6">
                  <span className="text-xs font-extrabold tracking-[0.18em] text-[var(--color-primary)]">{number}</span>
                  <h3 className="mt-3 font-display text-2xl font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{text}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="devis" className="scroll-mt-24 grid gap-8 lg:grid-cols-[1fr_430px] lg:items-start">
            <div className="pt-2">
              <IconChefHat size={34} className="text-[var(--color-primary)]" />
              <h2 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">Parlons de votre projet.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-gray-600">Indiquez-nous les informations essentielles. Le formulaire conserve le fonctionnement et les données déjà utilisés par le service.</p>
            </div>
            <DevisForm serviceSlug={serviceOffering.slug} />
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f3eb] text-[#20231f]">
      <section className="mx-auto max-w-[1180px] px-4 pb-5 pt-9 sm:px-6 sm:pb-7 sm:pt-12">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Service location</p>
        <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">Location de matériel</h1>
        {serviceOffering.description && <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-gray-600 sm:text-base">{serviceOffering.description}</p>}
      </section>
      <main className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6">
        <RentalCheckoutClient
          service={{ id: serviceOffering.id, slug: serviceOffering.slug, title: serviceOffering.title }}
          rentalItems={rentalItems}
          tenant={{ currency: tenant.currency }}
          externalPaymentMethods={externalPaymentMethods}
        />
      </main>
    </div>
  );
}
