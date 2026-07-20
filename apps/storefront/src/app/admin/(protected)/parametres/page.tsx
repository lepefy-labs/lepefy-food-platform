import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { PaymentMethodsSection } from './PaymentMethodsSection';
import type { TenantPaymentMethod } from '@lepefy/types';

export const dynamic = 'force-dynamic';

export default async function ParametresPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: paymentMethods } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Paramètres</h1>
      <p className="text-sm text-gray-500 mb-6">
        Configuration de votre boutique
      </p>

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Carte digitale</h2>
        <p className="text-xs text-gray-400 mb-4">
          À imprimer ou partager pour renvoyer vos clients vers votre fiche contact.
        </p>

        <div className="flex items-start gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/api/card/qr-code?size=240"
            alt="QR code carte digitale"
            width={120}
            height={120}
            className="rounded-lg border border-gray-100"
          />

          <div className="flex flex-col gap-2">
            <a
              href="/api/card/qr-code?format=svg&size=1000&download=1"
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-center"
            >
              Télécharger QR (SVG, impression)
            </a>
            <a
              href="/api/card/qr-code?format=png&size=1000&download=1"
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-center"
            >
              Télécharger QR (PNG)
            </a>
          </div>
        </div>
      </section>

      <div className="mt-6">
        <PaymentMethodsSection initialMethods={(paymentMethods ?? []) as TenantPaymentMethod[]} />
      </div>
    </div>
  );
}
