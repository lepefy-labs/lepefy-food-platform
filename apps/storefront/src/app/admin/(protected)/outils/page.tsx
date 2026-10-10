import { IconDownload, IconFileTypePdf } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import ShareLinkActions from '../../_components/ui/ShareLinkActions';
import { SettingsIconTile } from '../parametres/_components/SettingsUi';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ACTION_CLS = 'inline-flex min-h-11 items-center gap-2 rounded-lg border border-a-border bg-a-surface px-3 text-sm font-medium text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus';

const QR_TOOLS = [
  {
    key: 'qr-boutique',
    title: 'QR boutique',
    description: 'Accès direct à votre boutique en ligne.',
    preview: '/api/shop/qr-code?size=180',
    downloads: [
      { label: 'SVG', href: '/api/shop/qr-code?format=svg&size=1000&download=1' },
      { label: 'PNG', href: '/api/shop/qr-code?format=png&size=1000&download=1' },
    ],
  },
  {
    key: 'qr-carte',
    title: 'QR carte',
    description: 'Votre carte digitale à partager avec vos clients.',
    preview: '/api/card/qr-code?size=180',
    downloads: [
      { label: 'SVG', href: '/api/card/qr-code?format=svg&size=1000&download=1' },
      { label: 'PNG', href: '/api/card/qr-code?format=png&size=1000&download=1' },
    ],
  },
];

// Tenant tools (QR codes, posters, share links): operational assets, not settings.
export default async function OutilsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const origin = (tenant.storefront_url || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  const shareLinks = origin
    ? [
      { key: 'boutique', title: 'Boutique en ligne', url: origin, message: `Découvrez ${tenant.name} : ${origin}` },
      { key: 'carte', title: 'Carte digitale', url: `${origin}/card`, message: `La carte de ${tenant.name} : ${origin}/card` },
    ]
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 pb-10">
      <AdminPageHeader title="Outils du tenant" description="QR codes, affiches et liens à partager avec vos clients." />

      <section aria-labelledby="outils-qr">
        <h2 id="outils-qr" className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-a-text-3">QR codes</h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {QR_TOOLS.map((tool) => (
            <li key={tool.key} id={tool.key} className="flex gap-4 rounded-2xl border border-a-border bg-a-surface p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tool.preview} alt={`${tool.title} — aperçu`} width={96} height={96} className="h-24 w-24 shrink-0 rounded-lg border border-a-border bg-a-surface" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-a-text">{tool.title}</h3>
                <p className="mt-1 text-sm text-a-text-3">{tool.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {tool.downloads.map((download) => (
                    <a key={download.label} href={download.href} className={ACTION_CLS} aria-label={`Télécharger ${tool.title} en ${download.label}`}>
                      <IconDownload size={16} aria-hidden="true" />{download.label}
                    </a>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="outils-affiches">
        <h2 id="outils-affiches" className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-a-text-3">Affiches</h2>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-a-border bg-a-surface p-5">
          <SettingsIconTile icon={IconFileTypePdf} accent="red" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-a-text">Affiche carte digitale</h3>
            <p className="mt-0.5 text-sm text-a-text-3">PDF prêt à imprimer avec le QR de votre carte.</p>
          </div>
          <a href="/api/admin/card/poster" className={ACTION_CLS}><IconDownload size={16} aria-hidden="true" />Affiche PDF</a>
        </div>
      </section>

      <section aria-labelledby="outils-liens">
        <h2 id="outils-liens" className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-a-text-3">Liens partageables</h2>
        {shareLinks.length > 0 ? (
          <ul className="grid gap-4 md:grid-cols-2">
            {shareLinks.map((link) => (
              <li key={link.key} className="rounded-2xl border border-a-border bg-a-surface p-5">
                <h3 className="mb-3 text-base font-semibold text-a-text">{link.title}</h3>
                <ShareLinkActions url={link.url} message={link.message} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-a-border p-5 text-sm text-a-text-3">Renseignez l’URL de la boutique dans Paramètres › Profil pour obtenir des liens partageables.</p>
        )}
      </section>
    </div>
  );
}
