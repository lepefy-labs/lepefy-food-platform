'use client';

import { useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { cn } from '@/lib/utils/cn';
import Button, { IconButton } from '@/app/admin/_components/ui/Button';
import Dialog from '@/app/admin/_components/ui/Dialog';
import { FormField, Input, Select } from '@/app/admin/_components/ui/Form';
import InlineAlert, { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';

const fields = [['orders_count', 'Nombre de commandes'], ['lifetime_value', 'Valeur client'], ['average_order_value', 'Panier moyen'], ['days_since_last_order', 'Jours depuis le dernier achat'], ['created_at', 'Date de création'], ['source', 'Source'], ['marketing_consent', 'Consentement marketing'], ['loyalty_points', 'Points fidélité'], ['rfm_segment', 'Segment RFM'], ['tag', 'Tag'], ['favorite_category', 'Catégorie préférée'], ['favorite_product', 'Produit préféré'], ['event_participation', 'Participation événements']];
const operators = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'not_contains', 'before', 'after', 'in', 'not_in'];
const NUMERIC_FIELDS = ['orders_count', 'lifetime_value', 'average_order_value', 'days_since_last_order', 'loyalty_points', 'event_participation'];
type Condition = { field: string; operator: string; value: string };

export function SegmentBuilder() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<'and' | 'or'>('and');
  const [conditions, setConditions] = useState<Condition[]>([{ field: 'orders_count', operator: '>=', value: '2' }]);
  const [preview, setPreview] = useState<number | null>(null);
  const previewMutation = useAdminMutation();
  const saveMutation = useAdminMutation();

  const definition = () => ({
    operator: group,
    conditions: conditions.map((c) => ({ ...c, value: NUMERIC_FIELDS.includes(c.field) ? Number(c.value) : c.field === 'marketing_consent' ? c.value === 'true' : c.value })),
  });
  const update = (index: number, patch: Partial<Condition>) => setConditions((current) => current.map((c, n) => (n === index ? { ...c, ...patch } : c)));

  async function previewNow() {
    const result = await previewMutation.run<{ count: number }>('/api/admin/clients/segments/preview', { body: { definition: definition() }, refresh: false });
    if (result) setPreview(result.count);
  }

  async function save() {
    const result = await saveMutation.run('/api/admin/clients/segments', { body: { name, definition: definition() }, successMessage: 'Segment créé.' });
    if (result) setOpen(false);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><IconPlus size={18} aria-hidden="true" />Créer un segment</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!saveMutation.pending}
        size="lg"
        title="Créer un segment"
        footer={<>
          <Button variant="secondary" onClick={() => void previewNow()} loading={previewMutation.pending}>Prévisualiser</Button>
          <Button disabled={!name || conditions.length === 0} loading={saveMutation.pending} onClick={() => void save()}>Créer</Button>
        </>}
      >
        <div className="space-y-4">
          <FormField label="Nom du segment" required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></FormField>
          <div role="radiogroup" aria-label="Combinaison des conditions" className="inline-flex gap-1 rounded-lg border border-a-border bg-a-surface-2 p-1 text-sm">
            {([['and', 'Toutes les conditions'], ['or', 'Au moins une']] as const).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={group === value} onClick={() => setGroup(value)}
                className={cn('min-h-9 rounded-md px-3 font-semibold', group === value ? 'bg-a-surface text-a-text shadow-sm' : 'text-a-text-2 hover:text-a-text')}>
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-a-border bg-a-surface-2 p-3 sm:grid-cols-[1fr_120px_1fr_40px]">
                <Select aria-label="Critère" value={c.field} onChange={(e) => update(i, { field: e.target.value })}>{fields.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                <Select aria-label="Opérateur" value={c.operator} onChange={(e) => update(i, { operator: e.target.value })}>{operators.map((o) => <option key={o}>{o}</option>)}</Select>
                <Input aria-label="Valeur" value={c.value} onChange={(e) => update(i, { value: e.target.value })} />
                <IconButton label="Supprimer la condition" variant="ghost" className="text-tone-danger-fg" icon={<IconTrash size={18} aria-hidden="true" />} onClick={() => setConditions((v) => v.filter((_, n) => n !== i))} />
              </div>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setConditions((v) => [...v, { field: 'orders_count', operator: '>=', value: '1' }])}><IconPlus size={16} aria-hidden="true" />Ajouter une condition</Button>
          {preview !== null && <InlineAlert tone="success">{preview} clients correspondent</InlineAlert>}
          <ErrorText message={previewMutation.error ?? saveMutation.error} />
        </div>
      </Dialog>
    </>
  );
}
