import Link from 'next/link';
import { IconLock, IconRosetteDiscountCheck } from '@tabler/icons-react';
import { getTenant } from '@/lib/tenant/getTenant';
import { resolveReviewFormContext } from '@/lib/reviews/reviewService';
import ReviewForm from './ReviewForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const headingStyle = { fontFamily: 'var(--font-bricolage), var(--font-inter), system-ui, sans-serif' };
const actionClass = 'mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)]';

export default async function GiveReviewPage({ searchParams }: { searchParams: { order?: string; token?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const context = await resolveReviewFormContext(tenant.id, searchParams.order ?? null, searchParams.token ?? null);

  if (!context) return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600"><IconLock size={24} aria-hidden="true" /></span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950" style={headingStyle}>Avis indisponible</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-600">Ce lien est invalide ou expiré, ou cette commande ne permet pas encore de déposer un avis.</p>
        <Link href="/orders" className={actionClass}>Mes commandes</Link>
      </section>
    </div>
  );

  if (context.existing) return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><IconRosetteDiscountCheck size={26} aria-hidden="true" /></span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950" style={headingStyle}>Avis déjà enregistré</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Merci pour votre retour. Un seul avis est accepté par commande vérifiée.</p>
        <Link href="/avis" className={actionClass}>Voir les avis</Link>
      </section>
    </div>
  );

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 text-center sm:mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><IconRosetteDiscountCheck size={16} aria-hidden="true" /> Commande vérifiée</span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl" style={headingStyle}>Votre avis compte</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">Partagez votre expérience avec {tenant.name} et aidez les prochains clients.</p>
      </div>
      <ReviewForm orderId={context.orderId} token={context.token} />
    </div>
  );
}
