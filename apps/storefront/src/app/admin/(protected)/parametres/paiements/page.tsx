import { IconBuildingStore, IconCalendarEvent, IconId, IconTruck } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { SettingsPanel } from '../_components/SettingsUi';
import { PaymentMethodsSection } from '../PaymentMethodsSection';
import type { TenantPaymentMethod, PaymentModule } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const DEFAULT_ENABLED_MODULES: PaymentModule[] = ['shop', 'card', 'event', 'rental'];
const moduleLegend = [
  { label: 'Boutique', detail: 'Commandes du shop', icon: IconBuildingStore },
  { label: 'Carte', detail: 'Paiement depuis /card', icon: IconId },
  { label: 'Événements', detail: 'Prestations événementielles', icon: IconCalendarEvent },
  { label: 'Location', detail: 'Réservations de matériel', icon: IconTruck },
];

export default async function ParametresPaiementsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();
  const { data: paymentMethods } = await supabase.from('tenant_payment_methods').select('*').eq('tenant_id', tenant.id).order('sort_order', { ascending: true });
  const normalizedMethods = ((paymentMethods ?? []) as TenantPaymentMethod[]).map((m) => ({ ...m, enabled_modules: m.enabled_modules ?? DEFAULT_ENABLED_MODULES }));

  return (
    <SettingsPageShell sectionKey="paiements" description="Configurez la disponibilité des moyens de paiement utilisés par les services de la boutique.">
      <SettingsPanel
        title="Portée des moyens de paiement"
        description="Chaque moyen peut être proposé dans un ou plusieurs de ces services."
      >
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {moduleLegend.map(({ label, detail, icon: Icon }) => (
            <li key={label} className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-a-hover text-a-text-2"><Icon size={17} stroke={1.6} aria-hidden="true" /></span>
              <span><span className="block text-sm font-medium text-a-text">{label}</span><span className="mt-0.5 block text-xs leading-4 text-a-text-3">{detail}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-a-border pt-3 text-xs leading-5 text-a-text-3">
          Cette configuration agit uniquement sur la disponibilité des moyens de paiement. Aucun checkout, webhook ou flux transactionnel n&apos;est modifié ici.
        </p>
      </SettingsPanel>

      <PaymentMethodsSection initialMethods={normalizedMethods} />
    </SettingsPageShell>
  );
}
