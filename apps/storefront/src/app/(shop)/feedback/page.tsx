import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import FeedbackForm from './FeedbackForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Votre avis',
  robots: { index: false, follow: false },
};

type Campaign = {
  id: string;
  headline: string;
  intro: string | null;
  thank_you_message: string | null;
  version_label: string | null;
};

export default async function FeedbackPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  // The feature remains deployable before migration 106 is applied manually.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data, error } = await service
    .from('tester_feedback_campaigns')
    .select('id, headline, intro, thank_you_message, version_label')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .maybeSingle();
  const campaign = error ? null : data as Campaign | null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <section className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-xl shadow-black/5">
        <div className="h-2" style={{ backgroundColor: tenant.primary_color }} />
        <div className="p-6 sm:p-10">
          <div className="mb-7 flex items-center gap-3">
            {tenant.logo_url ? <img src={tenant.logo_url} alt="" className="h-12 w-12 rounded-xl object-contain" /> : null}
            <div>
              <p className="text-sm font-semibold text-gray-950">{tenant.name}</p>
              <p className="text-xs text-gray-500">Programme testeurs</p>
            </div>
          </div>
          {campaign ? (
            <FeedbackForm
              campaign={{ headline: campaign.headline, intro: campaign.intro, thankYouMessage: campaign.thank_you_message }}
              accentColor={tenant.primary_color}
            />
          ) : (
            <div className="py-8 text-center">
              <h1 className="text-2xl font-bold text-gray-950">Merci de votre visite</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
                Aucune campagne de test n’est ouverte pour le moment. Revenez bientôt pour partager votre avis.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
