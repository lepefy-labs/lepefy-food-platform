import Link from 'next/link';
import { Suspense } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { CAMPAIGN_KIND_LABEL, loadCampaignList, parseCampaignList, type Campaign } from '@/lib/catalog/campaigns';
import { CATALOG_CAMPAIGN_STATUS_META } from '@/lib/admin/statusRegistry';
import { formatDate, formatMoney } from '@/lib/admin/format';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import Badge from '../../../_components/ui/Badge';
import { ButtonLink } from '../../../_components/ui/Button';
import { Card } from '../../../_components/ui/Panel';
import AdminStatCard from '../../../_components/ui/AdminStatCard';
import { EmptyState, ErrorState } from '../../../_components/ui/States';
import FilterBar from '../../../_components/data/FilterBar';
import DataTable, { type DataColumn } from '../../../_components/data/DataTable';
import Pagination from '../../../_components/data/Pagination';
import CampaignActions from './CampaignActions';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function CampaignsPage({ searchParams }:{ searchParams:Record<string,string|string[]|undefined> }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const db = createServiceClient();
  const filters = parseCampaignList(searchParams);
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canManage = Boolean(access && canAdmin(access,'catalog.manage'));
  const [result, statusCounts] = await Promise.all([
    loadCampaignList(db,tenant.id,filters).catch(() => null),
    Promise.all(['running','scheduled','draft'].map(async (status) => {
      const { count } = await db.from('catalog_campaigns').select('id',{ count:'exact',head:true })
        .eq('tenant_id',tenant.id).eq('status',status);
      return count ?? 0;
    })),
  ]);
  const query = (patch:Record<string,string>) => {
    const params = new URLSearchParams();
    const state = { ...filters,...patch,page:patch.page ? Number(patch.page) : 1 };
    if (state.q) params.set('q',state.q);
    if (state.kind) params.set('kind',state.kind);
    if (state.status) params.set('status',state.status);
    if (state.sort !== 'created_desc') params.set('sort',state.sort);
    if (state.page>1) params.set('page',String(state.page));
    if (state.size!==25) params.set('size',String(state.size));
    return `/admin/catalogue/campagnes${params.size ? `?${params}` : ''}`;
  };
  const columns:DataColumn<Campaign>[] = [
    { key:'name',header:'Campagne',cell:(c) => <Link href={`/admin/catalogue/campagnes/${c.id}`} className="font-semibold text-a-brand-fg hover:underline">{c.name}</Link> },
    { key:'kind',header:'Type',cell:(c) => CAMPAIGN_KIND_LABEL[c.kind] },
    { key:'status',header:'État',cell:(c) => <Badge tone={CATALOG_CAMPAIGN_STATUS_META[c.status]!.tone} dot>{CATALOG_CAMPAIGN_STATUS_META[c.status]!.label}</Badge> },
    { key:'count',header:'Produits',align:'right',cell:(c) => c.product_count ?? 0 },
    { key:'start',header:'Début',cell:(c) => c.promo_starts_at || c.novelty_starts_at ? formatDate(c.promo_starts_at ?? c.novelty_starts_at,'date') : 'Immédiat' },
    { key:'end',header:'Fin',cell:(c) => c.promo_ends_at || c.novelty_ends_at ? formatDate(c.promo_ends_at ?? c.novelty_ends_at,'date') : '—' },
    { key:'discount',header:'Réduction',cell:(c) => c.kind==='novelty' ? '—' : c.discount_mode==='percent' ? `−${c.discount_value} %` : c.discount_mode==='fixed' ? `−${formatMoney(c.discount_value ?? 0,tenant.currency)}` : 'Par produit' },
    { key:'actions',header:<span className="sr-only">Actions</span>,align:'right',cell:(c) => <CampaignActions campaign={c} canManage={canManage} /> },
  ];
  return <div className="mx-auto w-full max-w-7xl">
    <AdminPageHeader title="Promotions & Nouveautés" breadcrumb={[{ label:'Catalogue',href:'/admin/catalogue' },{ label:'Campagnes' }]}
      description="Créez, programmez et suivez vos mises en avant."
      actions={canManage ? <ButtonLink href="/admin/catalogue/campagnes/nouvelle" variant="primary"><IconPlus size={17} aria-hidden="true" />Nouvelle campagne</ButtonLink> : undefined} />
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <AdminStatCard title="En cours" value={statusCounts[0] ?? 0} tone="success" href={query({ status:'running' })} active={filters.status==='running'} />
      <AdminStatCard title="Programmées" value={statusCounts[1] ?? 0} tone="info" href={query({ status:'scheduled' })} active={filters.status==='scheduled'} />
      <AdminStatCard title="Brouillons" value={statusCounts[2] ?? 0} tone="neutral" href={query({ status:'draft' })} active={filters.status==='draft'} />
    </div>
    <Card as="section" className="overflow-hidden">
      <Suspense fallback={<div className="h-14 border-b border-a-border" />}>
        <FilterBar search={{ label:'Rechercher une campagne',placeholder:'Nom de la campagne' }}
          filters={[{ type:'select',key:'kind',label:'Type',allLabel:'Tous les types',options:Object.entries(CAMPAIGN_KIND_LABEL).map(([value,label]) => ({ value,label })) },
            { type:'select',key:'status',label:'État',allLabel:'Tous les états',options:Object.entries(CATALOG_CAMPAIGN_STATUS_META).map(([value,meta]) => ({ value,label:meta.label })) }]}
          sort={{ value:filters.sort,options:[{ value:'created_desc',label:'Plus récentes' },{ value:'name_asc',label:'Nom A → Z' },{ value:'start_asc',label:'Début croissant' },{ value:'start_desc',label:'Début décroissant' }] }}
          resetHref="/admin/catalogue/campagnes" resultLabel={`${result?.total ?? 0} campagnes`} />
      </Suspense>
      {!result ? <ErrorState title="Impossible de charger les campagnes." action={<ButtonLink href="/admin/catalogue/campagnes">Réessayer</ButtonLink>} />
        : <DataTable caption="Campagnes du catalogue" columns={columns} rowKey={(c) => c.id} rows={result.campaigns}
          mobileCard={(c) => <div className="space-y-2 p-4"><div className="flex items-start justify-between gap-2"><Link href={`/admin/catalogue/campagnes/${c.id}`} className="font-semibold">{c.name}</Link><Badge tone={CATALOG_CAMPAIGN_STATUS_META[c.status]!.tone}>{CATALOG_CAMPAIGN_STATUS_META[c.status]!.label}</Badge></div><p className="text-sm text-a-text-2">{CAMPAIGN_KIND_LABEL[c.kind]} · {c.product_count ?? 0} produits</p><CampaignActions campaign={c} canManage={canManage} /></div>}
          empty={<EmptyState variant={filters.q || filters.kind || filters.status ? 'filtered' : 'empty'} title="Aucune campagne à afficher." description="Créez une campagne pour regrouper vos produits et programmer leur mise en avant." action={canManage ? <ButtonLink href="/admin/catalogue/campagnes/nouvelle">Nouvelle campagne</ButtonLink> : undefined} />} />}
      {result && result.total>0 && <Pagination window={result.window} noun="campagnes" hrefForPage={(page) => query({ page:String(page) })} hrefForPageSize={(size) => query({ size:String(size) })} />}
    </Card>
  </div>;
}
