'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HELP_MODULES } from '@/lib/helpCenter/domain';
import { slugify } from '@/lib/helpCenter/rules';
import Button from '../../../../_components/ui/Button';
import { FormField, Input, Select } from '../../../../_components/ui/Form';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { useAdminMutation } from '../../../../_components/ui/useAdminMutation';

export default function NewArticleForm() {
  const router = useRouter();
  const { run, pending, error } = useAdminMutation();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [moduleKey, setModuleKey] = useState('commandes');
  const [level, setLevel] = useState<'standard' | 'advanced'>('standard');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await run<{ id: string }>('/api/admin/platform/knowledge/articles', {
      body: { title, slug: slug || slugify(title), module: moduleKey, minLevel: level }, refresh: false,
    });
    if (result?.id) router.push(`/admin/platform/knowledge/${result.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-a-border bg-a-surface p-4">
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <FormField label="Titre (français)" required><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required /></FormField>
      <FormField label="Slug" hint="Adresse de la guide : minuscules, chiffres et tirets. Laissé vide, il est déduit du titre.">
        <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={slugify(title) || 'preparer-une-commande'} maxLength={80} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Module"><Select value={moduleKey} onChange={(event) => setModuleKey(event.target.value)}>{Object.entries(HELP_MODULES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></FormField>
        <FormField label="Niveau commercial" hint="Les guides « Avancé » ne sont servies qu’aux boutiques du niveau avancé (non activé aujourd’hui).">
          <Select value={level} onChange={(event) => setLevel(event.target.value as 'standard' | 'advanced')}><option value="standard">Standard</option><option value="advanced">Avancé</option></Select>
        </FormField>
      </div>
      <div className="flex justify-end"><Button type="submit" loading={pending} disabled={!title.trim()}>Créer le brouillon</Button></div>
    </form>
  );
}
