import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { featureForAiEndpoint } from '@/lib/ai/productUsage';
import AiCostHistoryChart, { type AiCostHistoryPoint } from './AiCostHistoryChart';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface CostRow {
  month: string;
  provider: string;
  endpoint: string;
  total_calls: number | string;
  total_cost_usd: number | string;
}

function monthKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function PlatformAiUsagePage() {
  const cookieStore = cookies();
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );

  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect('/admin/login');

  const service = createServiceClient();
  const { data: admin } = await service
    .from('admin_users')
    .select('role, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin || admin.role !== 'platform_owner') redirect('/admin');

  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const historyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const { data } = await service
    .from('ai_usage_monthly_by_tenant')
    .select('month, provider, endpoint, total_calls, total_cost_usd')
    .eq('tenant_id', tenant.id)
    .gte('month', historyStart.toISOString())
    .order('month', { ascending: true })
    .order('provider', { ascending: true })
    .order('endpoint', { ascending: true });

  const historyRows = (data ?? []) as CostRow[];
  const rowsByMonth = new Map<string, CostRow[]>();
  for (const row of historyRows) {
    const key = monthKey(row.month);
    const rows = rowsByMonth.get(key) ?? [];
    rows.push(row);
    rowsByMonth.set(key, rows);
  }

  const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
  const fullMonthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const historyPoints: AiCostHistoryPoint[] = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(historyStart.getUTCFullYear(), historyStart.getUTCMonth() + index, 1));
    const key = monthKey(date);
    const monthRows = rowsByMonth.get(key) ?? [];
    const details = monthRows.map((row) => ({
      feature: featureForAiEndpoint(row.endpoint).label,
      provider: row.provider,
      endpoint: row.endpoint,
      calls: Number(row.total_calls) || 0,
      cost: Number(row.total_cost_usd) || 0,
    }));
    return {
      key,
      label: monthFormatter.format(date).replace('.', ''),
      fullLabel: fullMonthFormatter.format(date),
      cost: details.reduce((sum, row) => sum + row.cost, 0),
      calls: details.reduce((sum, row) => sum + row.calls, 0),
      details,
    };
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Plateforme</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Coûts IA</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Suivi des coûts provider pour {tenant.name}. Cette vue est réservée à Lepefy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            12 derniers mois
          </span>
          <span className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            IA incluse · $0 facturé au tenant
          </span>
        </div>
      </header>

      <AiCostHistoryChart points={historyPoints} />

      <p className="text-xs text-gray-400">
        Les coûts restent des données internes de unit economics. Aucun quota, overage ou supplément IA n’est appliqué au tenant aujourd’hui.
      </p>
    </div>
  );
}
