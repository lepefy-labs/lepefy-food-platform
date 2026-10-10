'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils/format';
import { ambassadorDisplayName } from '@/lib/ambassador/ambassadorAdmin';
import Button from '../../_components/ui/Button';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';

export interface AmbassadorListRow {
  id: string;
  email: string;
  full_name: string | null;
  ambassador_first_name: string | null;
  ambassador_last_name: string | null;
  ambassador_payment_method: 'IBAN' | 'PAYPAL' | null;
  ambassador_profile_completed_at: string | null;
  promoted_to_ambassador_at: string | null;
  confirmedBalance: number;
  paidTotal: number;
}

export function AmbassadorsListSection({ ambassadors, currency }: { ambassadors: AmbassadorListRow[]; currency: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<AmbassadorListRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  async function demote(row: AmbassadorListRow) {
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ambassador/demote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: row.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setMessage({ text: body?.error ?? 'Retrait du statut impossible.', tone: 'error' });
        return;
      }
      setMessage({ text: `${ambassadorDisplayName(row)} n’est plus ambassadeur.`, tone: 'ok' });
      router.refresh();
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setIsSaving(false);
      setTarget(null);
    }
  }

  return (
    <section className="rounded-xl border border-a-border bg-a-surface p-5">
      <h2 className="mb-1 text-sm font-semibold text-a-text-2">Ambassadeurs</h2>
      <p className="mb-4 text-xs text-a-text-3">
        Le lien d&apos;invitation de l&apos;ambassadeur fonctionne dès sa nomination. Un profil incomplet accumule ses commissions,
        mais ne peut pas être payé tant que nom, prénom et IBAN ou PayPal ne sont pas renseignés dans son compte.
      </p>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{message.text}</p>
      )}

      {ambassadors.length === 0 ? (
        <p className="text-sm text-a-text-3">Aucun ambassadeur pour l&apos;instant. Nommez-en un ci-dessous.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-a-text-3">
                <th className="py-1.5 font-medium">Ambassadeur</th>
                <th className="py-1.5 font-medium">Profil de paiement</th>
                <th className="py-1.5 font-medium">À verser</th>
                <th className="py-1.5 font-medium">Déjà versé</th>
                <th className="py-1.5 font-medium"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {ambassadors.map((a) => (
                <tr key={a.id} className="border-t border-a-border">
                  <td className="py-2">
                    <Link href={`/admin/clients/${a.id}`} className="font-medium text-a-text hover:underline">{ambassadorDisplayName(a)}</Link>
                    <div className="text-a-text-3">{a.email}</div>
                    {a.promoted_to_ambassador_at && (
                      <div className="text-a-text-3">depuis le {new Date(a.promoted_to_ambassador_at).toLocaleDateString('fr-FR')}</div>
                    )}
                  </td>
                  <td className="py-2">
                    {a.ambassador_profile_completed_at
                      ? <span className="text-tone-success-fg">Complet · {a.ambassador_payment_method === 'IBAN' ? 'IBAN' : 'PayPal'}</span>
                      : <span className="text-tone-warning-fg">Incomplet</span>}
                  </td>
                  <td className="py-2 font-medium">{formatPrice(a.confirmedBalance, currency)}</td>
                  <td className="py-2 text-a-text-3">{formatPrice(a.paidTotal, currency)}</td>
                  <td className="py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => setTarget(a)}>Retirer le statut…</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={target !== null}
        title="Retirer le statut d’ambassadeur ?"
        description={`${target ? ambassadorDisplayName(target) : 'Ce client'} ne générera plus de commission pour les prochaines commandes livrées de ses invités. Les commissions déjà créées${target && target.confirmedBalance > 0 ? ` (${formatPrice(target.confirmedBalance, currency)} à verser)` : ''} restent dues et visibles.`}
        confirmLabel="Retirer le statut"
        destructive
        loading={isSaving}
        onCancel={() => setTarget(null)}
        onConfirm={() => { if (target) void demote(target); }}
      />
    </section>
  );
}
