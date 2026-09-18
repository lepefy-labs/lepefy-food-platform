import Link from 'next/link';
import { IconLock, IconRosetteDiscountCheck } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { resolveReviewFormContext } from '@/lib/reviews/reviewService';
import ReviewForm from './ReviewForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function GiveReviewPage({ searchParams }: { searchParams: { order?: string; token?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const context = await resolveReviewFormContext(tenant.id, searchParams.order ?? null, searchParams.token ?? null);
  if (!context) return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-500"><IconLock size={24} /></span>
      <h1 className="mt-4 text-2xl font-bold text-gray-950">Avis indisponible</h1>
      <p className="mt-2 text-sm leading-6 text-gray-500">Le lien est invalide ou expiré, ou cette commande ne permet pas encore de déposer un avis.</p>
      <Link href="/orders" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700">Mes commandes</Link>
    </div>
  );
  if (context.existing) return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><IconRosetteDiscountCheck size={26} /></span>
      <h1 className="mt-4 text-2xl font-bold text-gray-950">Avis déjà enregistré</h1>
      <p className="mt-2 text-sm text-gray-500">Merci. Un seul avis de service est accepté par commande vérifiée.</p>
      <Link href="/avis" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white">Voir les avis</Link>
    </div>
  );
  return (
    <div className="mx-auto max-w-xl px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
      <div className="mb-6 text-center">
        <span className="mx-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><IconRosetteDiscountCheck size={16} /> Commande vérifiée</span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-950">Comment s’est passée votre expérience ?</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500">Votre avis nous aide à améliorer votre expérience et à guider les prochains clients. Vous pouvez aussi nous dire en quelques mots ce que vous avez apprécié ou ce que nous pouvons améliorer.</p>
      </div>
      <ReviewForm orderId={context.orderId} token={context.token} />
    </div>
  );
}
