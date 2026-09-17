/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantFeatureSetting } from '@/lib/entitlements/tenantFeatureSettings';
import { getReviewSettings } from '@/lib/reviews/reviewSettings';
import { hasTenantFeature } from '@/lib/entitlements/tenantEntitlements';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import ReviewAdminClient, { type AdminReviewRow } from './ReviewAdminClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PAGE_SIZE = 25;
const VALID_STATUSES = new Set(['pending_moderation','published','rejected','hidden']);

export default async function AdminReviewsPage({ searchParams }: { searchParams: { status?: string; rating?: string; page?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const entitled = await hasTenantFeature(tenant.id, 'reviews').catch(() => false);
  if (!entitled) return <div className="mx-auto max-w-4xl"><AdminPageHeader title="Avis clients" description="La fonctionnalité Avis vérifiés n’est pas incluse pour ce tenant." /></div>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const access = await getCurrentAdminAccessContext(tenant.id);
  const canModerate = Boolean(access && canAdmin(access, 'reviews.moderate'));
  const canManage = Boolean(access && canAdmin(access, 'reviews.manage'));
  const status = searchParams.status && VALID_STATUSES.has(searchParams.status) ? searchParams.status : '';
  const parsedRating = Number(searchParams.rating);
  const rating = Number.isInteger(parsedRating) && parsedRating >= 1 && parsedRating <= 5 ? parsedRating : 0;
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let reviewsQuery = db.from('reviews')
    .select('id, order_id, customer_id, rating, body, reviewer_display_name, status, moderation_flags, moderation_reason_code, submitted_at, published_at', { count: 'exact' })
    .eq('tenant_id', tenant.id);
  if (status) reviewsQuery = reviewsQuery.eq('status', status);
  if (rating) reviewsQuery = reviewsQuery.eq('rating', rating);
  reviewsQuery = reviewsQuery.order('submitted_at', { ascending: false }).range(from, to);

  const [featureSetting, settings, reviewsResult, statsResult, pendingResult, sentInvitesResult, completedInvitesResult] = await Promise.all([
    getTenantFeatureSetting(tenant.id, 'reviews'),
    getReviewSettings(tenant.id),
    reviewsQuery,
    db.from('tenant_review_stats').select('*').eq('tenant_id', tenant.id).maybeSingle(),
    db.from('reviews').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending_moderation'),
    db.from('review_invites').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).not('sent_at', 'is', null),
    db.from('review_invites').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).not('completed_at', 'is', null),
  ]);

  const rawReviews = reviewsResult.data ?? [];
  const orderIds = [...new Set(rawReviews.map((review: any) => review.order_id))];
  const { data: orders } = orderIds.length ? await db.from('orders').select('id, created_at, total').eq('tenant_id', tenant.id).in('id', orderIds) : { data: [] };
  const ordersById = new Map((orders ?? []).map((order: any) => [order.id, order]));
  const reviews: AdminReviewRow[] = rawReviews.map((review: any) => {
    const order = ordersById.get(review.order_id) as any;
    return { ...review, moderation_flags: review.moderation_flags ?? [], orderNumber: `#${String(review.order_id).slice(0,8).toUpperCase()}`, orderDate: order?.created_at ?? null, orderTotal: order?.total ?? null };
  });

  const total = reviewsResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stats = statsResult.data;
  const sentCount = sentInvitesResult.count ?? 0;
  const completedCount = completedInvitesResult.count ?? 0;
  const filterHref = (next: { status?: string; rating?: number; page?: number }) => {
    const params = new URLSearchParams();
    const s = next.status ?? status;
    const r = next.rating ?? rating;
    const pg = next.page ?? 1;
    if (s) params.set('status', s);
    if (r) params.set('rating', String(r));
    if (pg > 1) params.set('page', String(pg));
    const qs = params.toString();
    return `/admin/avis${qs ? `?${qs}` : ''}`;
  };

  return <div className="mx-auto w-full max-w-6xl pb-10">
    <AdminPageHeader title="Avis clients" description="Collectez des avis de service uniquement après une commande payée et terminée, puis modérez-les sans modifier le texte du client." meta={featureSetting?.enabled ? 'Collecte active' : 'Collecte désactivée'} />
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Note publiée</p><p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{stats?.average_rating ? Number(stats.average_rating).toFixed(1) : '—'}</p></div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Avis publiés</p><p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{Number(stats?.published_count ?? 0)}</p></div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">À modérer</p><p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{pendingResult.count ?? 0}</p></div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Conversion invitations</p><p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{sentCount ? `${Math.round((completedCount/sentCount)*100)}%` : '—'}</p><p className="mt-1 text-xs text-gray-400">{completedCount}/{sentCount} envoyées</p></div>
    </div>

    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Statut</span>
      {[['','Tous'],['pending_moderation','À modérer'],['published','Publiés'],['rejected','Rejetés'],['hidden','Masqués']].map(([value,label]) => <Link key={value} href={filterHref({ status: value, page: 1 })} className={`rounded-lg px-3 py-2 text-sm font-medium ${status === value ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}>{label}</Link>)}
      <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Note</span>
      {[0,1,2,3,4,5].map((value) => <Link key={value} href={filterHref({ rating: value, page: 1 })} className={`rounded-lg px-2.5 py-2 text-sm font-medium ${rating === value ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}>{value ? `${value}★` : 'Toutes'}</Link>)}
    </div>

    <ReviewAdminClient initialReviews={reviews} enabled={featureSetting?.enabled ?? false} publicDisplay={settings.publicDisplay} minPublicCount={settings.minPublicCount} blacklistTerms={settings.blacklistTerms} canModerate={canModerate} canManage={canManage} />

    {totalPages > 1 && <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination avis">
      <span className="text-gray-500">Page {page} sur {totalPages} · {total} avis</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="min-h-11 rounded-xl border border-gray-200 px-4 py-2.5 font-semibold text-gray-700" href={filterHref({ page: page - 1 })}>Précédent</Link>}
        {page < totalPages && <Link className="min-h-11 rounded-xl bg-[var(--admin-primary)] px-4 py-2.5 font-semibold text-white" href={filterHref({ page: page + 1 })}>Suivant</Link>}
      </div>
    </nav>}
  </div>;
}
