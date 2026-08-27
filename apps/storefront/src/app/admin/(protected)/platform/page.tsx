import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PlatformConsolePage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const [{ count: tenantCount }, { count: adminCount }, { data: plans }] = await Promise.all([
    service.from('tenants').select('id', { count: 'exact', head: true }),
    service.from('admin_users').select('id', { count: 'exact', head: true }).eq('active', true),
    service.from('platform_plans').select('id, code, name, monthly_price_cents, currency, active').order('created_at', { ascending: true }),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Plateforme</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">Console Lepefy</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Configuration et opérations strictement internes à la plateforme.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><p className="text-xs text-gray-500">Tenants</p><p className="mt-1 text-2xl font-semibold">{tenantCount ?? 0}</p></div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><p className="text-xs text-gray-500">Admins actifs</p><p className="mt-1 text-2xl font-semibold">{adminCount ?? 0}</p></div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><p className="text-xs text-gray-500">Plans actifs</p><p className="mt-1 text-2xl font-semibold">{(plans ?? []).filter((plan: { active: boolean }) => plan.active).length}</p></div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold">Outils plateforme</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Link href="/admin/team" className="rounded-xl border border-gray-200 p-4 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Administrateurs</Link>
          <Link href="/admin/platform/ai-usage" className="rounded-xl border border-gray-200 p-4 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Coûts IA</Link>
          <Link href="/admin/platform/notifications" className="rounded-xl border border-gray-200 p-4 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Diagnostics notifications</Link>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-4"><h2 className="text-sm font-semibold">Plans SaaS</h2><span className="text-xs text-gray-400">Source de vérité plateforme</span></div>
        <div className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
          {(plans ?? []).length === 0 ? (
            <p className="py-4 text-sm text-amber-600">Migration billing plateforme non encore appliquée.</p>
          ) : (plans ?? []).map((plan: { id: string; name: string; code: string; monthly_price_cents: number; currency: string; active: boolean }) => (
            <div key={plan.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div><p className="font-semibold">{plan.name}</p><p className="text-xs text-gray-400">{plan.code}</p></div>
              <div className="text-right"><p className="font-semibold">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: plan.currency }).format(plan.monthly_price_cents / 100)}/mois</p><p className="text-xs text-gray-400">{plan.active ? 'Actif' : 'Inactif'}</p></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
