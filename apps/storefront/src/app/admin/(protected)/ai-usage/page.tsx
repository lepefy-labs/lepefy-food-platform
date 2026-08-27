import { redirect } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { aggregateTenantAiUsage, aiUsageUnitLabel, type AiRawUsageRow } from '@/lib/ai/productUsage';
import TenantAiUsageHistory, { type TenantAiUsageMonth } from './TenantAiUsageHistory';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface MonthlyUsageRow extends AiRawUsageRow {
  month: string;
}

function monthKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function TenantAiUsagePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const supabase = createServiceClient();

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('slug', slug)
    .single();

  if (error || !tenant) redirect('/admin');

  const now = new Date();
  const historyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const { data } = await supabase
    .from('ai_usage_monthly_by_tenant')
    .select('month, endpoint, total_calls')
    .eq('tenant_id', tenant.id)
    .gte('month', historyStart.toISOString())
    .order('month', { ascending: true });

  const rawRows = (data ?? []) as MonthlyUsageRow[];
  const rowsByMonth = new Map<string, AiRawUsageRow[]>();
  for (const row of rawRows) {
    const key = monthKey(row.month);
    const monthRows = rowsByMonth.get(key) ?? [];
    monthRows.push({ endpoint: row.endpoint, total_calls: row.total_calls });
    rowsByMonth.set(key, monthRows);
  }

  const shortMonthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
  const fullMonthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const months: TenantAiUsageMonth[] = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(historyStart.getUTCFullYear(), historyStart.getUTCMonth() + index, 1));
    const key = monthKey(date);
    const features = aggregateTenantAiUsage(rowsByMonth.get(key) ?? []);
    const total = features.reduce((sum, feature) => sum + feature.usageCount, 0);

    return {
      key,
      label: shortMonthFormatter.format(date).replace('.', ''),
      fullLabel: fullMonthFormatter.format(date),
      total,
      features: features.map((feature) => ({
        key: feature.key,
        label: feature.label,
        description: feature.description,
        usageCount: feature.usageCount,
        unitLabel: aiUsageUnitLabel(feature),
      })),
    };
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Abonnement</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Utilisation IA</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Suivez l’utilisation des fonctionnalités d’intelligence artificielle incluses pour {tenant.name}.
          </p>
        </div>
        <span className="w-fit rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
          Incluse dans l’abonnement
        </span>
      </header>

      <TenantAiUsageHistory months={months} />

      <p className="text-xs text-gray-400">
        Les fournisseurs, modèles, tokens et coûts techniques restent gérés par Lepefy et ne sont pas exposés dans cet espace.
      </p>
    </div>
  );
}
