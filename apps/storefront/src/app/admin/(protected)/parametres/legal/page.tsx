import { IconInfoCircle } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { TenantFieldsForm } from '../_components/TenantFieldsForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresLegalPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <SettingsPageShell sectionKey="legal">
      <TenantFieldsForm
        id="informations-legales"
        title="Entreprise"
        description="Données légales utilisées sur vos documents."
        initialValues={{ legal_name: tenant.legal_name, legal_email: tenant.legal_email, legal_address: tenant.legal_address }}
        fields={[
          { name: 'legal_name', label: 'Raison sociale', autoComplete: 'organization' },
          { name: 'legal_email', label: 'Email légal', type: 'email', autoComplete: 'email' },
          { name: 'legal_address', label: 'Adresse légale', type: 'textarea', wide: true },
        ]}
        note={
          <p className="flex gap-2 rounded-xl border border-tone-warning-border bg-tone-warning-bg px-3 py-2.5 text-sm leading-6 text-tone-warning-fg">
            <IconInfoCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
            Ces informations apparaissent sur les étiquettes produits imprimées. Vérifiez leur exactitude avant modification.
          </p>
        }
      />
    </SettingsPageShell>
  );
}
