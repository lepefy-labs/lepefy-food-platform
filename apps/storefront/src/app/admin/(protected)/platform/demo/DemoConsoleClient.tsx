'use client';

import { useState, type FormEvent } from 'react';
import Button from '../../../_components/ui/Button';
import { ErrorText } from '../../../_components/ui/InlineAlert';
import CopyableValue from '../../../_components/ui/CopyableValue';
import { useAdminMutation } from '../../../_components/ui/useAdminMutation';
import { useConfirm } from '../../../_components/ui/ConfirmDialog';
import { controlClasses, labelClasses } from '../../../_components/ui/Form';

export function PresentationControls({ active }: { active: boolean }) {
  const start = useAdminMutation();
  const end = useAdminMutation();
  const [confirm, confirmDialog] = useConfirm();
  return (
    <div className="flex flex-col items-end gap-1">
      {confirmDialog}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={start.pending} onClick={() => start.run('/api/admin/platform/demo/presentation', { body: { minutes: active ? 60 : 120 }, successMessage: active ? 'Présentation prolongée d’une heure' : 'Présentation démarrée pour deux heures' })}>
          {active ? 'Prolonger d’une heure' : 'Démarrer une présentation'}
        </Button>
        {active && (
          <Button size="sm" variant="outline" loading={end.pending} onClick={async () => {
            if (!(await confirm({ title: 'Terminer la présentation ?', description: 'La remise à zéro nocturne pourra de nouveau s’exécuter.', confirmLabel: 'Terminer' }))) return;
            await end.run('/api/admin/platform/demo/presentation', { method: 'DELETE', successMessage: 'Présentation terminée' });
          }}>
            Terminer
          </Button>
        )}
      </div>
      <ErrorText message={start.error ?? end.error} />
    </div>
  );
}

const NEXT_STATUS = { new: { status: 'contacted', label: 'Marquer contactée' }, contacted: { status: 'closed', label: 'Clore' }, closed: { status: 'new', label: 'Rouvrir' } } as const;

export function RequestActions({ id, status, note }: { id: string; status: keyof typeof NEXT_STATUS; note: string | null }) {
  const mutation = useAdminMutation();
  const [draft, setDraft] = useState(note ?? '');
  const next = NEXT_STATUS[status];
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className={`${labelClasses} flex-1`}>
        Note de suivi
        <input id={`demo-request-note-${id}`} value={draft} maxLength={1000} onChange={(event) => setDraft(event.target.value)} className={controlClasses} placeholder="Ex. Rappelée le 24/10, rendez-vous mardi" />
      </label>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" loading={mutation.pending} onClick={() => mutation.run(`/api/admin/platform/demo/requests/${id}`, { method: 'PATCH', body: { note: draft }, successMessage: 'Note enregistrée' })}>
          Enregistrer la note
        </Button>
        <Button size="sm" variant="secondary" loading={mutation.pending} onClick={() => mutation.run(`/api/admin/platform/demo/requests/${id}`, { method: 'PATCH', body: { status: next.status }, successMessage: 'Demande mise à jour' })}>
          {next.label}
        </Button>
      </div>
      <ErrorText message={mutation.error} />
    </div>
  );
}

export function AccessLinkForm() {
  const mutation = useAdminMutation();
  const [result, setResult] = useState<{ url: string; expiresAt: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const json = await mutation.run<{ url: string; expiresAt: string }>('/api/admin/platform/demo/access-link', {
      body: { label: data.get('label'), days: Number(data.get('days')) }, refresh: false,
    });
    if (json) setResult(json);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <label className={labelClasses}>
          Pour qui
          <input id="demo-access-label" name="label" required maxLength={40} pattern="[a-z0-9-]+" className={controlClasses} placeholder="Ex. tata-pao" />
        </label>
        <label className={labelClasses}>
          Valable
          <select id="demo-access-days" name="days" defaultValue="7" className={controlClasses}>
            <option value="1">1 jour</option>
            <option value="3">3 jours</option>
            <option value="7">7 jours</option>
          </select>
        </label>
        <Button type="submit" loading={mutation.pending}>Créer le lien</Button>
      </div>
      <ErrorText message={mutation.error} />
      {result && <CopyableValue label="Lien d’accès" value={result.url} />}
    </form>
  );
}
