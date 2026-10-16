'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '../../../../_components/ui/Button';
import { useConfirm } from '../../../../_components/ui/ConfirmDialog';
import { useAdminToast } from '../../../../_components/ui/Toaster';

/** « Réessayer » on a failed, abandoned or uncertain delivery (platform owner). */
export function DeliveryRetryButton({ id, tenantId, uncertain }: { id: string; tenantId: string; uncertain: boolean }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [ask, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);

  async function retry() {
    const ok = await ask(uncertain ? {
      title: 'Relancer un envoi au résultat incertain ?',
      description: 'Le fournisseur a peut-être déjà remis ce message. Relancez seulement si le destinataire confirme ne pas l’avoir reçu : sinon il le recevra deux fois.',
      confirmLabel: 'Relancer quand même', destructive: true,
    } : {
      title: 'Relancer cet envoi ?',
      description: 'Un nouvel essai part immédiatement ; trois essais automatiques supplémentaires sont accordés en cas d’échec.',
      confirmLabel: 'Relancer',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/platform/notification-deliveries/${id}/retry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, confirmUncertain: uncertain }),
      });
      const body = await res.json().catch(() => null) as { accepted?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'Erreur');
      if (body?.accepted) toast.success('Envoi accepté.'); else toast.error(`Nouvel échec${body?.error ? ` : ${body.error}` : ''}.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erreur');
    } finally { setBusy(false); }
  }

  return (
    <>
      {dialog}
      <Button variant="outline" size="sm" loading={busy} onClick={retry}>Réessayer</Button>
    </>
  );
}
