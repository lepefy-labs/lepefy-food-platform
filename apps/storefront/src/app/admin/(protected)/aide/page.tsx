import Link from 'next/link';
import { IconBook2, IconSearch } from '@tabler/icons-react';
import { helpModuleLabel } from '@/lib/helpCenter/domain';
import { cleanSearchQuery } from '@/lib/helpCenter/rules';
import { normalizeHelpLocale, requireHelpTenantPage } from '@/lib/helpCenter/server/access';
import { helpCatalog, helpSearch } from '@/lib/helpCenter/server/service';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { Card } from '../../_components/ui/Panel';
import { Input } from '../../_components/ui/Form';
import Button from '../../_components/ui/Button';
import { EmptyState } from '../../_components/ui/States';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** All guides this admin may read, grouped by module; plain GET search (works without JavaScript). */
export default async function HelpCenterPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { tenant, access, level } = await requireHelpTenantPage();
  const scope = { tenantId: tenant.id, access, level, locale: normalizeHelpLocale(Array.isArray(searchParams.lang) ? searchParams.lang[0] : searchParams.lang) };
  const raw = Array.isArray(searchParams.q) ? searchParams.q[0] : searchParams.q;
  const query = cleanSearchQuery(raw);
  const [catalog, found] = await Promise.all([helpCatalog(scope), query ? helpSearch(scope, query) : Promise.resolve(null)]);
  const items = found ?? catalog;
  const groups = Array.from(new Set(items.map((item) => item.module)));

  return (
    <div className="space-y-5">
      <AdminPageHeader title="Centre d’aide" description="Des guides courts, pas à pas, pour utiliser votre administration." />
      <form role="search" method="get" action="/admin/aide" className="flex max-w-xl gap-2">
        <label htmlFor="help-q" className="sr-only">Rechercher dans l’aide</label>
        <div className="relative flex-1">
          <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
          <Input id="help-q" name="q" defaultValue={query} placeholder="Rechercher une guide… (ex. imprimer, promo)" className="pl-9" maxLength={80} autoComplete="off" />
        </div>
        <Button type="submit" variant="secondary">Rechercher</Button>
      </form>
      {query && (
        <p className="text-sm text-a-text-2" role="status">
          {items.length === 0 ? `Aucune guide ne correspond à « ${query} ».` : `${items.length} résultat${items.length > 1 ? 's' : ''} pour « ${query} ».`}{' '}
          <Link href="/admin/aide" className="font-semibold text-a-brand-fg underline-offset-2 hover:underline">Tout afficher</Link>
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState variant={query ? 'filtered' : 'empty'} title={query ? 'Aucun résultat' : 'Aucune guide pour le moment'} description={query ? 'Essayez un autre mot.' : 'Les guides arrivent bientôt.'} />
      ) : (
        groups.map((module) => (
          <section key={module} aria-labelledby={`help-${module}`} className="space-y-2">
            <h2 id={`help-${module}`} className="flex items-center gap-2 text-sm font-semibold text-a-text"><IconBook2 size={16} aria-hidden="true" className="text-a-text-3" />{helpModuleLabel(module)}</h2>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {items.filter((item) => item.module === module).map((item) => (
                <li key={item.slug}>
                  <Link href={`/admin/aide/${item.slug}${scope.locale !== 'fr' ? `?lang=${scope.locale}` : ''}`} className="block h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
                    <Card className="h-full p-3 hover:bg-a-hover">
                      <p className="text-sm font-semibold text-a-text">{item.title}</p>
                      {item.summary && <p className="mt-1 text-sm leading-5 text-a-text-2">{item.summary}</p>}
                      {item.stepCount > 0 && <p className="mt-1 text-xs text-a-text-3">{item.stepCount} étape{item.stepCount > 1 ? 's' : ''}</p>}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
