/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from 'next/link';
import { IconRosetteDiscountCheck, IconStar } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canUseReviews } from '@/lib/entitlements/tenantEntitlements';
import { getReviewSettings } from '@/lib/reviews/reviewSettings';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function Stars({ rating }: { rating: number }) {
  return <span className="inline-flex" aria-label={`${rating} sur 5`}>{[1,2,3,4,5].map((value) => <IconStar key={value} size={16} fill={value <= Math.round(rating) ? 'currentColor' : 'none'} className={value <= Math.round(rating) ? 'text-amber-500' : 'text-gray-300'} />)}</span>;
}

export default async function ReviewsPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  if (!(await canUseReviews(tenant.id))) return <div className="mx-auto max-w-2xl px-4 py-16 text-center"><h1 className="text-2xl font-bold text-gray-950">Avis indisponibles</h1><p className="mt-2 text-sm text-gray-500">Cette fonctionnalité n’est pas activée pour le moment.</p></div>;
  const settings = await getReviewSettings(tenant.id);
  if (!settings.publicDisplay) return <div className="mx-auto max-w-2xl px-4 py-16 text-center"><h1 className="text-2xl font-bold text-gray-950">Avis non publiés</h1><p className="mt-2 text-sm text-gray-500">La collecte est active, mais l’affichage public est désactivé.</p></div>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const [{ data: stats }, { data: reviews }] = await Promise.all([
    db.from('tenant_review_stats').select('*').eq('tenant_id', tenant.id).maybeSingle(),
    db.from('reviews').select('id, rating, body, reviewer_display_name, published_at').eq('tenant_id', tenant.id).eq('status', 'published').order('published_at', { ascending: false }).limit(50),
  ]);
  const count = Number(stats?.published_count ?? 0);
  const showAggregate = count >= settings.minPublicCount;
  const average = Number(stats?.average_rating ?? 0);
  const distribution = [5,4,3,2,1].map((rating) => ({ rating, count: Number(stats?.[`rating_${rating}`] ?? 0) }));
  return (
    <div className="mx-auto max-w-4xl px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
      <header className="mb-8 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><IconRosetteDiscountCheck size={16} /> Avis issus de commandes vérifiées</span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">Avis clients</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">Chaque avis est rattaché à une commande payée et terminée. Les contenus sont modérés pour le spam, les données personnelles et les abus, jamais parce qu’une note est basse.</p>
      </header>
      {showAggregate ? <section className="mb-8 grid gap-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:grid-cols-[180px_1fr] sm:p-7">
        <div className="flex flex-col items-center justify-center border-b border-gray-100 pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-5"><p className="text-4xl font-black text-gray-950">{average.toFixed(1)}</p><Stars rating={average} /><p className="mt-2 text-xs text-gray-500">{count} avis publié{count > 1 ? 's' : ''}</p></div>
        <div className="space-y-2">{distribution.map((row) => <div key={row.rating} className="flex items-center gap-3 text-xs"><span className="w-8 font-semibold text-gray-700">{row.rating}★</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${count ? (row.count / count) * 100 : 0}%` }} /></span><span className="w-8 text-right text-gray-400">{row.count}</span></div>)}</div>
      </section> : <div className="mb-8 rounded-2xl bg-gray-50 px-5 py-4 text-center text-sm text-gray-600">Les premiers avis vérifiés arrivent. La note moyenne sera affichée à partir de {settings.minPublicCount} avis publiés.</div>}
      <div className="space-y-4">{(reviews ?? []).map((review: any) => <article key={review.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-gray-950">{review.reviewer_display_name || 'Client vérifié'}</p><span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><IconRosetteDiscountCheck size={14} /> Commande vérifiée</span></div><div className="text-right"><Stars rating={review.rating} /><p className="mt-1 text-xs text-gray-400">{review.published_at ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(review.published_at)) : ''}</p></div></div>{review.body && <p className="mt-4 whitespace-pre-line text-sm leading-6 text-gray-700">{review.body}</p>}</article>)}</div>
      {count === 0 && <div className="rounded-3xl border border-dashed border-gray-300 p-10 text-center"><p className="font-semibold text-gray-900">Aucun avis publié pour le moment</p><p className="mt-1 text-sm text-gray-500">Les clients ayant terminé un achat pourront partager leur expérience.</p></div>}
      <div className="mt-8 text-center"><Link href="/orders" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">Retrouver mes commandes</Link></div>
    </div>
  );
}
