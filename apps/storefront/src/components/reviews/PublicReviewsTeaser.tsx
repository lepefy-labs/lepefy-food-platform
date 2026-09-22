import Link from 'next/link';
import { IconArrowRight, IconRosetteDiscountCheck, IconStar } from '@tabler/icons-react';
import type { PublicReviewSummary } from '@/lib/reviews/publicReviewSummary';

export function PublicReviewsTeaser({
  summary,
  compact = false,
}: {
  summary: PublicReviewSummary | null;
  compact?: boolean;
}) {
  if (!summary) return null;

  const score = summary.averageRating !== null && summary.publishedCount !== null
    ? summary.averageRating.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : null;
  const subtitle = score !== null
    ? `${score}/5 · ${summary.publishedCount} avis publié${summary.publishedCount === 1 ? '' : 's'}`
    : summary.publishedCount !== null && summary.publishedCount > 0
      ? 'Découvrez les premiers avis de nos clients.'
      : 'Découvrez les avis vérifiés de notre boutique.';

  return (
    <section aria-label="Avis clients" className={`rounded-2xl border border-emerald-100 bg-white shadow-sm ${compact ? 'my-3 px-3 py-3 sm:px-4' : 'mx-4 my-5 px-4 py-4 sm:px-6'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            {score !== null ? <IconStar size={23} fill="currentColor" aria-hidden="true" /> : <IconRosetteDiscountCheck size={23} aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-gray-900 sm:text-base">Avis clients vérifiés</h2>
            <p className="mt-0.5 text-xs leading-5 text-gray-600 sm:text-sm">{subtitle}</p>
          </div>
        </div>
        <Link href="/avis" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-emerald-200 px-4 text-sm font-semibold text-emerald-900 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:self-auto">
          Voir les avis <IconArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
