'use client';

import { useState } from 'react';
import { IconPalette } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import { Drawer } from '../../_components/ui/Dialog';
import InlineAlert from '../../_components/ui/InlineAlert';
import { FormField, Input, Textarea } from '../../_components/ui/Form';
import { useAdminMutation } from '../../_components/ui/useAdminMutation';
import type { StudioStyleInstructions, StudioStyleView } from '@/lib/studio/domain';
import { formatDate } from '@/lib/admin/format';

const FIELDS: Array<{ key: Exclude<keyof StudioStyleInstructions, 'version' | 'avoid'>; label: string; rows: number }> = [
  { key: 'summary', label: 'Résumé affiché à la boutique', rows: 1 },
  { key: 'background', label: 'Fond', rows: 2 },
  { key: 'lighting', label: 'Lumière', rows: 2 },
  { key: 'composition', label: 'Cadrage', rows: 3 },
  { key: 'mood', label: 'Ambiance', rows: 2 },
  { key: 'palette', label: 'Couleurs', rows: 2 },
  { key: 'photoGuidance', label: 'Règle pour les photos', rows: 4 },
  { key: 'ideaGuidance', label: 'Règle pour les idées', rows: 4 },
];

/**
 * « Style de la boutique »: read-only for the shop (what is applied, which
 * version, history). Lepefy (platform owner) publishes a new version; rows are
 * immutable and images already made keep their version.
 */
export default function StudioStyleButton() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ active: StudioStyleView; history: StudioStyleView[]; canEdit: boolean } | null>(null);
  const [draft, setDraft] = useState<StudioStyleInstructions | null>(null);
  const [note, setNote] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const mutation = useAdminMutation();

  async function load() {
    setOpen(true);
    setLoadError(null);
    const response = await fetch('/api/admin/studio/style').catch(() => null);
    const json = await response?.json().catch(() => null) as typeof data & { error?: string } | null;
    if (!response?.ok || !json?.active) { setLoadError(json?.error ?? 'Impossible de charger le style.'); return; }
    setData(json);
    setDraft(json.active.instructions);
  }

  async function publish() {
    if (!data || !draft) return;
    const result = await mutation.run<{ version: number }>('/api/admin/studio/style', {
      body: { instructions: draft, note, expectedVersion: data.history[0]?.version ?? data.active.version },
      successMessage: 'Nouveau style publié',
    });
    if (result) { setNote(''); await load(); }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => void load()}>
        <IconPalette size={18} aria-hidden="true" /> Style de la boutique
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Style de la boutique" description="Appliqué automatiquement à chaque image créée.">
        {loadError && <InlineAlert tone="danger">{loadError}</InlineAlert>}
        {data && draft && (
          <div className="space-y-4">
            <p className="text-sm text-a-text-2">Version {data.active.version} · depuis le {formatDate(data.active.createdAt)}{data.active.note ? ` · ${data.active.note}` : ''}</p>
            {data.canEdit ? (
              <>
                {FIELDS.map((field) => (
                  <FormField key={field.key} label={field.label}>
                    {field.rows === 1
                      ? <Input value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
                      : <Textarea rows={field.rows} value={draft[field.key]} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />}
                  </FormField>
                ))}
                <FormField label="À éviter" hint="Une règle par ligne.">
                  <Textarea rows={6} value={draft.avoid.join('\n')} onChange={(event) => setDraft({ ...draft, avoid: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 20) })} />
                </FormField>
                <FormField label="Note de version" optional>
                  <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
                </FormField>
                {mutation.error && <InlineAlert tone="danger">{mutation.error}</InlineAlert>}
                <Button onClick={() => void publish()} loading={mutation.pending}>Publier la version {(data.history[0]?.version ?? data.active.version) + 1}</Button>
              </>
            ) : (
              <dl className="space-y-3 text-sm">
                {FIELDS.slice(0, 6).map((field) => (
                  <div key={field.key}>
                    <dt className="font-semibold text-a-text">{field.label}</dt>
                    <dd className="text-a-text-2">{draft[field.key]}</dd>
                  </div>
                ))}
                <InlineAlert tone="info">Pour changer le style, écrivez à Lepefy : il s’appliquera aux prochaines images.</InlineAlert>
              </dl>
            )}
            {data.history.length > 1 && (
              <div>
                <h3 className="text-sm font-semibold text-a-text">Versions précédentes</h3>
                <ul className="mt-1 space-y-1 text-xs text-a-text-3">
                  {data.history.slice(1).map((version) => (
                    <li key={version.id}>Version {version.version} · {formatDate(version.createdAt)}{version.note ? ` · ${version.note}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
