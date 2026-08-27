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

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
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
  const currentKey = monthKey(currentMonthStart);
  const rows = historyRows.filter((row) => monthKey(row.month) === currentKey);
  const totalCalls = rows.reduce((sum, row) => sum + (Number(row.total_calls) || 0), 0);
  const totalCost = rows.reduce((sum, row) => sum + (Number(row.total_cost_usd) || 0), 0);

  const monthlyTotals = new Map<string, { calls: number; cost: number }>();
  for (const row of historyRows) {
    const key = monthKey(row.month);
    const current = monthlyTotals.get(key) ?? { calls: 0, cost: 0 };
    current.calls += Number(row.total_calls) || 0;
    current.cost += Number(row.total_cost_usd) || 0;
    monthlyTotals.set(key, current);
  }

  const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
  const fullMonthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const historyPoints: AiCostHistoryPoint[] = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(historyStart.getUTCFullYear(), historyStart.getUTCMonth() + index, 1));
    const key = monthKey(date);
    const monthly = monthlyTotals.get(key) ?? { calls: 0, cost: 0 };
    return {
      key,
      label: monthFormatter.format(date).replace('.', ''),
      fullLabel: fullMonthFormatter.format(date),
      cost: monthly.cost,
      calls: monthly.calls,
    };
  });

  const currentCost = historyPoints[historyPoints.length - 1]?.cost ?? 0;
  const previousCost = historyPoints[historyPoints.length - 2]?.cost ?? 0;
  const totalCost12Months = historyPoints.reduce((sum, point) => sum + point.cost, 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Plateforme</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Coûts IA</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Unit economics techniques pour {tenant.name}. Cette vue est réservée à Lepefy.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">Appels ce mois</p>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{totalCalls}</p>
        </div>
        <div className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500">Coût provider estimé</p>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{formatUsd(totalCost)}</p>
        </div>
        <div className="rounded-2xl border border-green-200 bg-green-50/70 p-4 shadow-sm dark:border-green-900 dark:bg-green-950/20">
          <p className="text-xs font-medium text-green-700 dark:text-green-300">Facturé au tenant pour l’IA</p>
          <p className="mt-2 text-2xl font-bold text-green-900 dark:text-green-100">$0.0000</p>
          <p className="mt-1 text-[11px] text-green-700 dark:text-green-300">Actuellement incluse dans le plan</p>
        </div>
      </section>

      <AiCostHistoryChart
        points={historyPoints}
        currentCost={currentCost}
        previousCost={previousCost}
        totalCost12Months={totalCost12Months}
      />

      <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Détail technique · mois courant</h2>
          <p className="mt-1 text-xs text-gray-400">Provider, endpoint et coûts restent internes à la plateforme.</p>
        </div>

        {rows.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">Aucune utilisation IA enregistrée ce mois-ci.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-left text-xs text-gray-400 dark:border-gray-800 dark:bg-gray-950/40">
                  <th className="px-5 py-3 font-medium">Fonction produit</th>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Endpoint</th>
                  <th className="px-4 py-3 text-right font-medium">Appels</th>
                  <th className="px-5 py-3 text-right font-medium">Coût estimé</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const feature = featureForAiEndpoint(row.endpoint);
                  return (
                    <tr key={`${row.provider}-${row.endpoint}`} className="border-b border-gray-50 last:border-0 dark:border-gray-800">
                      <td className="px-5 py-3 font-medium text-gray-800 dark:text-gray-200">{feature.label}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{row.provider}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{row.endpoint}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{Number(row.total_calls) || 0}</td>
                      <td className="px-5 py-3 text-right font-medium text-gray-900 dark:text-white">{formatUsd(Number(row.total_cost_usd) || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-950/40">
                  <td colSpan={3} className="px-5 py-3 font-semibold text-gray-700 dark:text-gray-200">Total du mois</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-950 dark:text-white">{totalCalls}</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-950 dark:text-white">{formatUsd(totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-400">
        Les crédits produit sont préparés dans le catalogue applicatif mais aucun quota, overage ou supplément IA n’est appliqué aujourd’hui.
      </p>
    </div>
  );
}
