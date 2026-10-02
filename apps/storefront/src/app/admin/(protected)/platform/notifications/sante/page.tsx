import Link from 'next/link';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconExternalLink } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { loadNotificationHealth, OVERDUE_RETRY_MINUTES, overallHealth, type HealthLevel } from '@/lib/notifications/notificationHealth';

export const dynamic = 'force-dynamic';

const LEVEL: Record<HealthLevel, { label: string; cls: string; Icon: typeof IconCircleCheck }> = {
  ok: { label: 'Tout fonctionne', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: IconCircleCheck },
  warning: { label: 'À surveiller', cls: 'border-amber-200 bg-amber-50 text-amber-800', Icon: IconAlertTriangle },
  error: { label: 'Action requise', cls: 'border-red-200 bg-red-50 text-red-800', Icon: IconCircleX },
};

const STATUS_LABELS: Array<[string, string]> = [
  ['accepted', 'Envoyés'], ['failed', 'Nouvel essai prévu'], ['dead', 'Échecs'], ['processing', 'En cours'],
];

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' });

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />;
}

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx.
export default async function PlatformNotificationHealthPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const health = await loadNotificationHealth(createServiceClient(), tenant.id);
  const level = LEVEL[overallHealth(health)];
  const { ledger, digest } = health;

  return (
    <div className="space-y-5">
      <div className={`flex items-center gap-3 rounded-2xl border px-5 py-4 ${level.cls}`}>
        <level.Icon size={24} />
        <div>
          <p className="font-semibold">{level.label}</p>
          <p className="text-sm opacity-80">Transport actif : {health.transport === 'brevo' ? 'Brevo API' : 'n8n send-email'} · état calculé à {dateFmt.format(new Date())}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Configuration">
          <ul className="space-y-2.5 text-sm">
            {health.config.map((item) => (
              <li key={item.label} className="flex items-center gap-3"><Dot ok={item.ok} /><span className="flex-1 text-gray-700 dark:text-gray-300">{item.label}</span><span className="text-gray-900 dark:text-gray-100">{item.detail}</span></li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-gray-500">Les secrets ne sont jamais affichés : seule leur présence est vérifiée.</p>
        </Card>

        <Card title="Compte Brevo" action={<a href="https://app.brevo.com/transactional/email/logs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--admin-primary)] hover:underline">Logs Brevo <IconExternalLink size={14} /></a>}>
          {!health.brevo ? (
            <p className="text-sm text-gray-500">Aucune clé API Brevo configurée.</p>
          ) : health.brevo.ok ? (
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center gap-3"><Dot ok /><span className="flex-1 text-gray-700 dark:text-gray-300">Clé API</span><span>Valide</span></li>
              {(health.brevo.plans ?? []).map((plan) => (
                <li key={`${plan.type}-${plan.creditsType}`} className="flex items-center gap-3"><span className="inline-block h-2.5 w-2.5" /><span className="flex-1 text-gray-700 dark:text-gray-300">Offre {plan.type}</span><span>{plan.credits == null ? '—' : `${new Intl.NumberFormat('fr-FR').format(plan.credits)} crédits`}</span></li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-3 text-sm text-red-700"><Dot ok={false} />Vérification impossible : <span className="font-mono">{health.brevo.error}</span></p>
          )}
        </Card>

        <Card title="Envois" action={<Link href="/admin/platform/notifications/historique" className="text-sm font-semibold text-[var(--admin-primary)] hover:underline">Historique →</Link>}>
          {!ledger.available ? <p className="text-sm text-gray-500">Historique indisponible (migration 136).</p> : (
            <>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="pb-2 font-medium">Statut</th><th className="pb-2 text-right font-medium">24 h</th><th className="pb-2 text-right font-medium">7 jours</th></tr></thead>
                <tbody>
                  {STATUS_LABELS.map(([status, label]) => (
                    <tr key={status} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-2 text-gray-700 dark:text-gray-300">{label}</td>
                      <td className={`py-2 text-right font-semibold ${status === 'dead' && (ledger.last24h.dead ?? 0) > 0 ? 'text-red-600' : ''}`}>{ledger.last24h[status] ?? 0}</td>
                      <td className="py-2 text-right">{ledger.last7d[status] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-500">Dernier envoi accepté : {ledger.lastAcceptedAt ? dateFmt.format(new Date(ledger.lastAcceptedAt)) : '—'}</p>
            </>
          )}
        </Card>

        <Card title="Schedulers">
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <Dot ok={ledger.overdueRetries === 0 && ledger.stuckProcessing === 0} />
              <div className="flex-1">
                <p className="text-gray-900 dark:text-gray-100">Nouveaux essais (toutes les 5 min)</p>
                <p className="text-xs text-gray-500">
                  {ledger.overdueRetries === 0 && ledger.stuckProcessing === 0
                    ? 'Aucun essai en retard.'
                    : `${ledger.overdueRetries} essai(s) en retard de plus de ${OVERDUE_RETRY_MINUTES} min, ${ledger.stuckProcessing} envoi(s) bloqué(s) : vérifier le workflow n8n « Notification retry scheduler ».`}
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Dot ok={digest.enabled === false || digest.lastRun?.status !== 'failed'} />
              <div className="flex-1">
                <p className="text-gray-900 dark:text-gray-100">Rapport quotidien (08h)</p>
                <p className="text-xs text-gray-500">
                  {digest.enabled === null ? 'Configuration indisponible.' : digest.enabled ? `Actif · fuseau ${digest.timezone}` : 'Désactivé pour ce tenant.'}
                  {digest.lastRun && <> · dernier rapport du {digest.lastRun.localDate} : {digest.lastRun.status}{digest.lastRun.acceptedAt ? ` à ${dateFmt.format(new Date(digest.lastRun.acceptedAt))}` : ''}{digest.lastRun.errorCode ? ` (${digest.lastRun.errorCode})` : ''}</>}
                </p>
              </div>
            </li>
          </ul>
          <a href="https://n8n.lepefy.com/home/workflows" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--admin-primary)] hover:underline">Workflows n8n <IconExternalLink size={14} /></a>
        </Card>

        <Card title="Destinataires internes du tenant">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {health.recipients.map((item) => (
              <li key={item.type} className="flex items-center gap-3">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${item.count > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} aria-hidden />
                <span className="flex-1 text-gray-700 dark:text-gray-300">{item.label}</span>
                <span className="font-semibold">{item.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">Sans destinataire, l’alerte correspondante n’est pas envoyée. Réglage côté tenant : Paramètres → Notifications.</p>
        </Card>
      </div>
    </div>
  );
}
