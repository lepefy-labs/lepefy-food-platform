// Public read model only. Never expose an aggregate before the tenant minimum.
export interface PublicReviewSummary {
  publishedCount: number | null;
  averageRating: number | null;
}

export interface PublishedReviewStats {
  published_count: number | string | null;
  average_rating: number | string | null;
}

export function summarizePublicReviewStats(
  stats: PublishedReviewStats | null,
  minPublicCount: number,
): PublicReviewSummary {
  const rawCount = Number(stats?.published_count ?? 0);
  const publishedCount = Number.isFinite(rawCount) && rawCount >= 0 ? Math.trunc(rawCount) : 0;
  const rawAverage = Number(stats?.average_rating);
  const averageRating = publishedCount >= minPublicCount
    && Number.isFinite(rawAverage)
    && rawAverage >= 1
    && rawAverage <= 5
    ? rawAverage
    : null;
  return { publishedCount, averageRating };
}
