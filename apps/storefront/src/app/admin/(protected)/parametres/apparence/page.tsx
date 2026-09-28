import Image from 'next/image';
import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { SettingsPanel } from '../_components/SettingsUi';
import { AppIconSection } from '../AppIconSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresApparencePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const colors = [
    { label: 'Couleur principale', value: tenant.primary_color },
    { label: 'Couleur secondaire', value: tenant.secondary_color },
    { label: 'Accent clair', value: tenant.accent_light },
  ].filter((color) => Boolean(color.value));

  return (
    <SettingsPageShell sectionKey="apparence">
      <SettingsPanel
        id="marque"
        title="Logo et couleurs"
        description="Identité de marque appliquée à la boutique, aux emails et aux documents. Pour la modifier, contactez l’équipe Lepefy."
      >
        <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
          <figure>
            <div className="flex h-28 w-44 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700">
              {tenant.logo_url
                ? <Image src={tenant.logo_url} alt={`Logo ${tenant.name}`} width={160} height={96} className="h-full w-full object-contain" />
                : <span className="text-sm text-gray-400">Aucun logo</span>}
            </div>
            <figcaption className="mt-2 text-xs text-gray-500 dark:text-gray-400">Logo de la boutique</figcaption>
          </figure>
          {colors.length > 0 && (
            <dl className="grid gap-3">
              {colors.map((color) => (
                <div key={color.label} className="flex items-center gap-3">
                  <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-lg border border-black/10" style={{ backgroundColor: color.value }} />
                  <div>
                    <dt className="text-sm font-medium text-gray-900 dark:text-gray-100">{color.label}</dt>
                    <dd className="font-mono text-xs uppercase text-gray-500 dark:text-gray-400">{color.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          )}
        </div>
      </SettingsPanel>

      <AppIconSection initialAppIconUrl={tenant.app_icon_url} hasLogoFallback={Boolean(tenant.logo_url)} />
    </SettingsPageShell>
  );
}
