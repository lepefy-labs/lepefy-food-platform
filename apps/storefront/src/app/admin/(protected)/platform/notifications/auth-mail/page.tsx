import { createServiceClient } from '@/lib/supabase/server';
import { authMailerEnabled } from '@/lib/authMailer/otpContext';
import { brandFor, languageFor, type TenantMailConfig } from '@/lib/authMailer/core/handler';
import { DEFAULT_FROM_ADDRESS, formatFrom, resolveFromAddress } from '@/lib/authMailer/core/sender';
import { renderAuthEmail } from '@/lib/authMailer/core/templates';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;
const nf = new Intl.NumberFormat('fr-FR');

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-a-text">{title}</h2>
      {children}
    </section>
  );
}

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx.
export default async function PlatformAuthMailPage() {
  const db = createServiceClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [tenantsRes, settingsRes, logRes] = await Promise.all([
    db.from('tenants').select('id, name, active, logo_url, primary_color, locale, locales').order('name'),
    db.from('tenant_auth_mail_settings').select('tenant_id, enabled, sender_name_override, language'),
    db.from('auth_mail_log').select('tenant_id, email_action_type, outcome').gte('created_at', since).limit(20000),
  ]);

  const migrationMissing = !!settingsRes.error || !!logRes.error;
  const settings = new Map((settingsRes.data ?? []).map((s) => [s.tenant_id as string, s]));
  const logs = logRes.data ?? [];
  const from = resolveFromAddress(process.env.AUTH_MAIL_FROM_ADDRESS);

  const configs: TenantMailConfig[] = (tenantsRes.data ?? []).map((t) => {
    const s = settings.get(t.id as string);
    return {
      id: t.id as string, name: t.name as string, active: t.active === true, logoUrl: t.logo_url as string | null,
      color: t.primary_color as string | null, locale: t.locale as string | null,
      locales: Array.isArray(t.locales) ? (t.locales as string[]) : [],
      enabled: s ? s.enabled !== false : true,
      senderNameOverride: (s?.sender_name_override as string | null) ?? null,
      languageOverride: (s?.language as string | null) ?? null,
    };
  });

  const count = (pred: (l: (typeof logs)[number]) => boolean) => logs.filter(pred).length;
  const accepted = count((l) => l.outcome === 'accepted');
  const failed = count((l) => l.outcome === 'failed');
  const rejected = count((l) => l.outcome === 'rejected');
  const attempts = accepted + failed;
  const successRate = attempts === 0 ? 'n.d.' : `${((accepted / attempts) * 100).toFixed(1).replace('.', ',')} %`;

  const byType = new Map<string, number>();
  for (const l of logs) byType.set(l.email_action_type ?? '—', (byType.get(l.email_action_type ?? '—') ?? 0) + 1);
  const perTenant = (id: string) => {
    const rows = logs.filter((l) => l.tenant_id === id);
    return { ok: rows.filter((r) => r.outcome === 'accepted').length, ko: rows.filter((r) => r.outcome === 'failed').length };
  };

  const preview = configs.find((c) => c.active);
  const previewMail = preview
    ? renderAuthEmail({ purpose: 'login', language: languageFor(preview), brand: brandFor(preview), code: '123456' })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-a-text">Emails d’authentification</h1>
        <p className="mt-1 text-sm text-a-text-2">
          Lepefy Auth Mailer : le code est généré par Supabase, l’email est composé et envoyé par Lepefy (Resend).
        </p>
      </div>

      <Card title="État">
        <ul className="space-y-1 text-sm text-a-text">
          <li>Contexte tenant signé côté boutique : <strong>{authMailerEnabled() ? 'actif' : 'inactif (aucun changement pour les clients)'}</strong></li>
          <li>Adresse d’expédition technique : <strong>{from}</strong>{from === DEFAULT_FROM_ADDRESS ? '' : ' (personnalisée)'}</li>
          {migrationMissing && <li className="text-tone-warning-fg">Migration 173 non appliquée : valeurs par défaut, aucun journal.</li>}
        </ul>
      </Card>

      <Card title={`Envois techniques (${WINDOW_DAYS} jours)`}>
        <p className="mb-3 text-sm text-a-text-2">
          « Accepté » signifie que Resend a accepté le message : ce n’est ni une livraison ni une ouverture.
        </p>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[['Acceptés', nf.format(accepted)], ['Échecs d’envoi', nf.format(failed)], ['Refus (contexte/signature)', nf.format(rejected)], ['Succès technique', successRate]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-a-text-3">{k}</dt><dd className="text-2xl font-semibold text-a-text">{v}</dd></div>
          ))}
        </dl>
        {byType.size > 0 && (
          <p className="mt-4 text-sm text-a-text-2">
            Par type : {[...byType].map(([k, v]) => `${k} ${nf.format(v)}`).join(' · ')}
          </p>
        )}
      </Card>

      <Card title="Boutiques">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-a-text-3">
              <tr><th className="py-2 pr-4">Boutique</th><th className="pr-4">Expéditeur</th><th className="pr-4">Langue</th><th className="pr-4">Logo</th><th className="pr-4">Statut</th><th>Envois (OK / échecs)</th></tr>
            </thead>
            <tbody className="text-a-text">
              {configs.map((c) => {
                const n = perTenant(c.id);
                return (
                  <tr key={c.id} className="border-t border-a-border">
                    <td className="py-2 pr-4 font-medium">{c.name}</td>
                    <td className="pr-4">{formatFrom(brandFor(c).name, from)}</td>
                    <td className="pr-4 uppercase">{languageFor(c)}</td>
                    <td className="pr-4">{c.logoUrl ? 'oui' : 'non'}</td>
                    <td className="pr-4">{!c.active ? 'Boutique inactive' : c.enabled ? 'Actif' : 'Désactivé'}</td>
                    <td>{nf.format(n.ok)} / {nf.format(n.ko)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {previewMail && preview && (
        <Card title={`Aperçu — ${preview.name}`}>
          <p className="mb-2 text-sm text-a-text-2">Objet : {previewMail.subject}</p>
          <iframe title="Aperçu de l’email" sandbox="" srcDoc={previewMail.html} className="h-[560px] w-full max-w-xl rounded-lg border border-a-border bg-white" />
        </Card>
      )}
    </div>
  );
}
