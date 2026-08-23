import type { InquiryWithService } from '../inquiryTypes';

export default function InquiryMetrics({ inquiries }: { inquiries: InquiryWithService[] }) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const newCount = inquiries.filter((item) => item.status === 'nouveau').length;
  const followupCount = inquiries.filter((item) => ['a_contacter', 'contacte', 'devis_envoye'].includes(item.status)).length;
  const acceptedCount = inquiries.filter((item) => item.status === 'accepte' && new Date(item.accepted_at ?? item.updated_at ?? item.created_at).getTime() >= thirtyDaysAgo).length;
  const actionable = inquiries.filter((item) => ['nouveau', 'a_contacter'].includes(item.status));
  const oldestAgeMs = actionable.length > 0
    ? Math.max(...actionable.map((item) => now - new Date(item.created_at).getTime()))
    : 0;
  const oldestLabel = oldestAgeMs <= 0
    ? '—'
    : oldestAgeMs < 60 * 60 * 1000
      ? `${Math.max(1, Math.floor(oldestAgeMs / 60000))} min`
      : oldestAgeMs < 24 * 60 * 60 * 1000
        ? `${Math.floor(oldestAgeMs / 3600000)} h`
        : `${Math.floor(oldestAgeMs / 86400000)} j`;

  const metrics = [
    { label: 'Nouvelles', value: String(newCount), detail: 'À qualifier' },
    { label: 'En suivi', value: String(followupCount), detail: 'Contact / devis' },
    { label: 'Acceptées', value: String(acceptedCount), detail: '30 derniers jours' },
    { label: 'Attente max.', value: oldestLabel, detail: 'Nouvelle / à contacter' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{metric.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950 dark:text-white">{metric.value}</p>
          <p className="mt-0.5 text-2xs text-gray-400 dark:text-gray-500">{metric.detail}</p>
        </div>
      ))}
    </div>
  );
}
