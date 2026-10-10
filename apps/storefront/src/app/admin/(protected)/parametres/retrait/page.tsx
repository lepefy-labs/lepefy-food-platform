import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { SettingsStatusBadge } from '../_components/SettingsUi';
import { TenantFieldsForm } from '../_components/TenantFieldsForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// One pickup point today (tenants.click_collect_*). The page is organised as a
// list of points so it can later read tenant_locations without a redesign.
export default async function ParametresRetraitPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <SettingsPageShell sectionKey="retrait">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-a-border bg-a-surface px-4 py-3 text-sm sm:px-6">
        <div>
          <p className="font-medium text-a-text">Retrait en boutique (click &amp; collect)</p>
          <p className="mt-0.5 text-xs text-a-text-3">Proposé au checkout selon la configuration de la boutique ; ce réglage n’est pas modifiable ici.</p>
        </div>
        <SettingsStatusBadge status={tenant.click_collect_enabled ? { label: 'Activé', tone: 'ok' } : { label: 'Désactivé', tone: 'neutral' }} />
      </div>

      <h2 className="pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-a-text-3">Points de retrait · 1</h2>

      <TenantFieldsForm
        id="point-principal"
        title="Point de retrait principal"
        description="Adresse, accès et horaires communiqués aux clients qui choisissent le retrait."
        initialValues={{
          click_collect_address: tenant.click_collect_address,
          google_maps_url: tenant.google_maps_url,
          click_collect_hours: tenant.click_collect_hours,
          click_collect_hours_it: tenant.click_collect_hours_it,
        }}
        fields={[
          { name: 'click_collect_address', label: 'Adresse', type: 'textarea', wide: true, autoComplete: 'street-address' },
          { name: 'google_maps_url', label: 'Lien Google Maps', type: 'url', placeholder: 'https://maps.app.goo.gl/…', wide: true, hint: 'Utilisé pour l’itinéraire sur la carte digitale et les confirmations de retrait.' },
          { name: 'click_collect_hours', label: 'Horaires (français)', placeholder: 'ex : Lun–Sam : 9h–20h' },
          { name: 'click_collect_hours_it', label: 'Horaires (italien)', placeholder: 'ex : Lun–Sab: 9–20' },
        ]}
      />
    </SettingsPageShell>
  );
}
