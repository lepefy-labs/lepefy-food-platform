'use client';

import { useMemo, useState } from 'react';
import { IconArrowDown, IconArrowUp, IconDeviceDesktop, IconDeviceMobile, IconTrash } from '@tabler/icons-react';
import {
  HELP_LOCALES, HELP_MODULES, HELP_STATUS_LABELS, type HelpBlock, type HelpLocale, type HelpStatus,
} from '@/lib/helpCenter/domain';
import { parseBlocks } from '@/lib/helpCenter/blocks';
import { canTransition } from '@/lib/helpCenter/rules';
import { formatDate } from '@/lib/admin/format';
import { HELP_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import type { ArticleRecord, ContextRecord, RevisionRecord, TranslationRecord } from '@/lib/helpCenter/server/platformService';
import { cn } from '@/lib/utils/cn';
import Badge from '../../../../_components/ui/Badge';
import Button, { IconButton } from '../../../../_components/ui/Button';
import ConfirmDialog, { useUnsavedChangesGuard } from '../../../../_components/ui/ConfirmDialog';
import { FormField, Input, Select, Textarea } from '../../../../_components/ui/Form';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { Panel } from '../../../../_components/ui/Panel';
import { useAdminMutation } from '../../../../_components/ui/useAdminMutation';
import HelpArticleBody from '../../../../_components/help/HelpArticleBody';

type Draft = { title: string; summary: string; blocks: HelpBlock[] };
const API = '/api/admin/platform/knowledge/articles';
const EMPTY: Draft = { title: '', summary: '', blocks: [] };
const BLOCK_LABELS: Record<HelpBlock['type'], string> = {
  heading: 'Titre', paragraph: 'Paragraphe', steps: 'Étapes', callout: 'Encadré', image: 'Image', video: 'Vidéo', related: 'Guide liée',
};
const NEW_BLOCK: Record<HelpBlock['type'], HelpBlock> = {
  heading: { type: 'heading', text: '' },
  paragraph: { type: 'paragraph', text: '' },
  steps: { type: 'steps', items: [''] },
  callout: { type: 'callout', tone: 'info', text: '' },
  image: { type: 'image', src: '', alt: '' },
  video: { type: 'video', url: '', title: '' },
  related: { type: 'related', slug: '' },
};

export default function KnowledgeEditor({ article, translations, contexts, revisions }: {
  article: ArticleRecord; translations: TranslationRecord[]; contexts: ContextRecord[]; revisions: RevisionRecord[];
}) {
  const { run, pending, error, setError } = useAdminMutation();
  const initialDrafts = useMemo(() => {
    const map = {} as Record<HelpLocale, Draft>;
    for (const locale of HELP_LOCALES) {
      const found = translations.find((translation) => translation.locale === locale);
      map[locale] = found ? { title: found.title, summary: found.summary, blocks: found.blocks } : EMPTY;
    }
    return map;
  }, [translations]);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [locale, setLocale] = useState<HelpLocale>('fr');
  const [meta, setMeta] = useState({ module: article.module, minLevel: article.min_level, requiredPermission: article.required_permission ?? '', requiredFlag: article.required_flag ?? '', position: article.position });
  const [routes, setRoutes] = useState(contexts.map((context) => context.route_pattern).join('\n'));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<'desktop' | 'mobile'>('desktop');
  const [confirm, setConfirm] = useState<null | { kind: 'status'; to: HelpStatus } | { kind: 'restore'; version: number }>(null);
  useUnsavedChangesGuard(dirty);

  const draft = drafts[locale];
  const edit = (patch: Partial<Draft>) => { setDrafts((current) => ({ ...current, [locale]: { ...current[locale], ...patch } })); setDirty(true); };
  const editBlock = (index: number, block: HelpBlock) => edit({ blocks: draft.blocks.map((existing, position) => (position === index ? block : existing)) });
  const moveBlock = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.blocks.length) return;
    const next = [...draft.blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    edit({ blocks: next });
  };

  const validation = useMemo(() => parseBlocks(draft.blocks), [draft.blocks]);
  const status = article.status;
  const statusInfo = statusMeta(HELP_STATUS_META, status);

  async function save(): Promise<boolean> {
    setError(null);
    const contextList = routes.split('\n').map((line) => line.trim()).filter(Boolean).map((routePattern, index) => ({ routePattern, priority: (index + 1) * 10 }));
    const hasContent = draft.title.trim().length > 0;
    const result = await run(`${API}/${article.id}`, {
      method: 'PATCH',
      body: {
        metadata: { ...meta, requiredPermission: meta.requiredPermission.trim(), requiredFlag: meta.requiredFlag.trim() },
        contexts: contextList,
        ...(hasContent ? { translation: { locale, title: draft.title, summary: draft.summary, blocks: draft.blocks } } : {}),
      },
      successMessage: 'Brouillon enregistré.', errorToast: true,
    });
    if (result) setDirty(false);
    return Boolean(result);
  }

  async function changeStatus(to: HelpStatus, note?: string) {
    if (dirty && !(await save())) return;
    const result = await run(`${API}/${article.id}/status`, { body: { to, expected: status, note }, successMessage: `Statut : ${HELP_STATUS_LABELS[to]}.`, errorToast: true });
    if (result) setConfirm(null);
  }

  async function restore(version: number) {
    const result = await run(`${API}/${article.id}/restore`, { body: { version }, successMessage: `Révision v${version} restaurée dans le brouillon (non publiée).`, errorToast: true });
    if (result) { setConfirm(null); setDirty(false); }
  }

  const transitions: Array<{ to: HelpStatus; label: string; variant: 'primary' | 'secondary' | 'outline' | 'danger' }> = [
    { to: 'review', label: 'Envoyer en relecture', variant: 'secondary' },
    { to: 'draft', label: status === 'archived' ? 'Remettre en brouillon' : 'Retour en brouillon', variant: 'outline' },
    { to: 'published', label: status === 'published' ? 'Republier' : 'Publier', variant: 'primary' },
    { to: 'archived', label: 'Archiver', variant: 'danger' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusInfo.tone} dot>{statusInfo.label}</Badge>
        <span className="text-xs text-a-text-3">v{article.version}{article.published_version ? ` · servie aux boutiques : v${article.published_version}` : ' · jamais publiée'}</span>
        <span className="flex-1" />
        <Button variant="secondary" loading={pending} disabled={!dirty} onClick={() => void save()}>Enregistrer le brouillon</Button>
        {transitions.filter((transition) => canTransition(status, transition.to)).map((transition) => (
          <Button key={transition.to} variant={transition.variant} disabled={pending || (transition.to === 'published' && !validation.ok)} onClick={() => setConfirm({ kind: 'status', to: transition.to })}>{transition.label}</Button>
        ))}
      </div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {status === 'published' && <InlineAlert tone="info">Les modifications restent dans le brouillon : les boutiques voient la v{article.published_version} jusqu’à la prochaine publication.</InlineAlert>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="Métadonnées">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Module"><Select value={meta.module} onChange={(event) => { setMeta({ ...meta, module: event.target.value }); setDirty(true); }}>{Object.entries(HELP_MODULES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></FormField>
              <FormField label="Niveau commercial"><Select value={meta.minLevel} onChange={(event) => { setMeta({ ...meta, minLevel: event.target.value as 'standard' | 'advanced' }); setDirty(true); }}><option value="standard">Standard</option><option value="advanced">Avancé</option></Select></FormField>
              <FormField label="Permission requise" optional hint="Ex. orders.view. Vide : toute personne ayant accès à l’aide."><Input value={meta.requiredPermission} onChange={(event) => { setMeta({ ...meta, requiredPermission: event.target.value }); setDirty(true); }} placeholder="orders.view" /></FormField>
              <FormField label="Flag de fonctionnalité requis" optional hint="Ex. business_management (Gestion)."><Input value={meta.requiredFlag} onChange={(event) => { setMeta({ ...meta, requiredFlag: event.target.value }); setDirty(true); }} placeholder="business_management" /></FormField>
            </div>
            <FormField label="Pages associées" optional hint="Une par ligne : /admin/orders, /admin/orders/[id], /admin/orders/* (tout le module). Jamais d’identifiant ni de paramètre.">
              <Textarea rows={3} value={routes} onChange={(event) => { setRoutes(event.target.value); setDirty(true); }} className="font-mono" />
            </FormField>
          </Panel>

          <Panel title="Contenu" description="Blocs structurés : aucun HTML libre. Seul **gras** est reconnu dans le texte.">
            <div role="tablist" aria-label="Langue" className="mb-3 flex gap-1">
              {HELP_LOCALES.map((code) => (
                <button key={code} type="button" role="tab" aria-selected={locale === code} onClick={() => setLocale(code)}
                  className={cn('min-h-9 rounded-lg px-3 text-sm font-semibold uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus', locale === code ? 'bg-a-brand-soft text-a-brand-fg' : 'text-a-text-2 hover:bg-a-hover')}>
                  {code}{drafts[code].title ? '' : ' ·'}
                </button>
              ))}
            </div>
            {locale !== 'fr' && !draft.title && <p className="mb-3 text-sm text-a-text-2">Pas encore traduit : les boutiques voient le français (repli déclaré).</p>}
            <div className="space-y-3">
              <FormField label="Titre"><Input value={draft.title} onChange={(event) => edit({ title: event.target.value })} maxLength={160} /></FormField>
              <FormField label="Résumé" optional><Textarea rows={2} value={draft.summary} onChange={(event) => edit({ summary: event.target.value })} maxLength={400} /></FormField>
              {draft.blocks.map((block, index) => (
                <BlockEditor key={index} block={block} onChange={(next) => editBlock(index, next)}
                  onUp={() => moveBlock(index, -1)} onDown={() => moveBlock(index, 1)} onDelete={() => edit({ blocks: draft.blocks.filter((_, position) => position !== index) })} />
              ))}
              <div className="flex flex-wrap gap-2" role="group" aria-label="Ajouter un bloc">
                {(Object.keys(NEW_BLOCK) as Array<HelpBlock['type']>).map((type) => (
                  <Button key={type} variant="outline" size="sm" onClick={() => edit({ blocks: [...draft.blocks, structuredClone(NEW_BLOCK[type])] })}>+ {BLOCK_LABELS[type]}</Button>
                ))}
              </div>
              {!validation.ok && <InlineAlert tone="warning" title="Contenu à corriger">{validation.error}</InlineAlert>}
            </div>
          </Panel>

          <Panel title="Historique des révisions" description="Chaque publication crée une révision immuable. Restaurer recopie dans le brouillon, sans publier.">
            {revisions.length === 0 ? <p className="text-sm text-a-text-2">Aucune révision publiée.</p> : (
              <ul className="divide-y divide-a-border">
                {Array.from(new Set(revisions.map((revision) => revision.version))).map((version) => {
                  const rows = revisions.filter((revision) => revision.version === version);
                  return (
                    <li key={version} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <b className="tabular-nums">v{version}</b>
                      <span className="uppercase text-a-text-3">{rows.map((row) => row.locale).join(' · ')}</span>
                      <span className="text-a-text-2">{formatDate(rows[0]!.created_at, 'datetime')}</span>
                      {rows[0]!.note && <span className="text-a-text-2">« {rows[0]!.note} »</span>}
                      <span className="flex-1" />
                      <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: 'restore', version })}>Restaurer</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Aperçu tel que la boutique le voit" actions={
          <div className="flex gap-1" role="group" aria-label="Taille de l’aperçu">
            <IconButton label="Aperçu bureau" icon={<IconDeviceDesktop size={18} />} variant={preview === 'desktop' ? 'secondary' : 'ghost'} onClick={() => setPreview('desktop')} aria-pressed={preview === 'desktop'} />
            <IconButton label="Aperçu mobile" icon={<IconDeviceMobile size={18} />} variant={preview === 'mobile' ? 'secondary' : 'ghost'} onClick={() => setPreview('mobile')} aria-pressed={preview === 'mobile'} />
          </div>
        }>
          <div className={cn('mx-auto space-y-3 rounded-[10px] border border-a-border bg-a-surface p-4', preview === 'mobile' ? 'max-w-[375px]' : 'max-w-md')}>
            <h3 className="text-lg font-semibold text-a-text">{draft.title || 'Sans titre'}</h3>
            {draft.summary && <p className="text-sm text-a-text-2">{draft.summary}</p>}
            {validation.ok ? <HelpArticleBody blocks={validation.blocks} /> : <p className="text-sm text-a-text-3">Corrigez les blocs pour voir l’aperçu.</p>}
          </div>
          <p className="mt-2 text-xs text-a-text-3">Aperçu avec les droits d’un administrateur de boutique. Un brouillon n’est jamais visible hors de cette console.</p>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'status'}
        title={confirm?.kind === 'status' ? `${transitions.find((transition) => transition.to === confirm.to)?.label ?? 'Changer le statut'} ?` : ''}
        description={confirm?.kind === 'status' && confirm.to === 'published'
          ? 'La guide devient visible par toutes les boutiques autorisées, immédiatement. Une révision immuable est créée.'
          : confirm?.kind === 'status' && confirm.to === 'archived' ? 'La guide n’est plus proposée aux boutiques. Les révisions restent conservées.' : 'Le statut de la guide change.'}
        confirmLabel="Confirmer"
        destructive={confirm?.kind === 'status' && confirm.to === 'archived'}
        loading={pending}
        error={error}
        reason={confirm?.kind === 'status' && confirm.to === 'published' ? { label: 'Note de révision (facultatif)', maxLength: 300 } : undefined}
        onConfirm={(reason) => { if (confirm?.kind === 'status') void changeStatus(confirm.to, reason); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'restore'}
        title={confirm?.kind === 'restore' ? `Restaurer la révision v${confirm.version} ?` : ''}
        description="Le contenu du brouillon est remplacé par cette révision. Rien n’est publié."
        confirmLabel="Restaurer"
        loading={pending}
        error={error}
        onConfirm={() => { if (confirm?.kind === 'restore') void restore(confirm.version); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function BlockEditor({ block, onChange, onUp, onDown, onDelete }: { block: HelpBlock; onChange: (block: HelpBlock) => void; onUp: () => void; onDown: () => void; onDelete: () => void }) {
  return (
    <fieldset className="space-y-2 rounded-[10px] border border-a-border bg-a-surface-2 p-3">
      <legend className="px-1 text-xs font-semibold text-a-text-2">{BLOCK_LABELS[block.type]}</legend>
      <div className="flex justify-end gap-1">
        <IconButton label="Monter ce bloc" icon={<IconArrowUp size={16} />} onClick={onUp} />
        <IconButton label="Descendre ce bloc" icon={<IconArrowDown size={16} />} onClick={onDown} />
        <IconButton label="Supprimer ce bloc" icon={<IconTrash size={16} />} onClick={onDelete} />
      </div>
      {(block.type === 'heading' || block.type === 'paragraph') && (
        <Textarea aria-label={BLOCK_LABELS[block.type]} rows={block.type === 'heading' ? 1 : 3} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
      )}
      {block.type === 'steps' && (
        <FormField label="Une étape par ligne"><Textarea rows={Math.max(3, block.items.length + 1)} value={block.items.join('\n')} onChange={(event) => onChange({ ...block, items: event.target.value.split('\n') })} /></FormField>
      )}
      {block.type === 'callout' && (
        <>
          <Select aria-label="Type d’encadré" value={block.tone} onChange={(event) => onChange({ ...block, tone: event.target.value as 'info' | 'warning' })}><option value="info">Information</option><option value="warning">Attention</option></Select>
          <Textarea aria-label="Texte de l’encadré" rows={2} value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} />
        </>
      )}
      {block.type === 'image' && (
        <div className="space-y-2">
          <FormField label="Adresse de l’image" hint="https://… ou /help/nom.png"><Input value={block.src} onChange={(event) => onChange({ ...block, src: event.target.value })} /></FormField>
          <FormField label="Texte alternatif" required><Input value={block.alt} onChange={(event) => onChange({ ...block, alt: event.target.value })} /></FormField>
          <FormField label="Légende" optional><Input value={block.caption ?? ''} onChange={(event) => onChange({ ...block, caption: event.target.value || undefined })} /></FormField>
        </div>
      )}
      {block.type === 'video' && (
        <div className="space-y-2">
          <FormField label="Adresse de la vidéo" hint="Lecteurs autorisés : YouTube (nocookie), Vimeo, Loom."><Input value={block.url} onChange={(event) => onChange({ ...block, url: event.target.value })} /></FormField>
          <FormField label="Titre de la vidéo" required><Input value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })} /></FormField>
        </div>
      )}
      {block.type === 'related' && (
        <FormField label="Slug de la guide liée"><Input value={block.slug} onChange={(event) => onChange({ ...block, slug: event.target.value })} placeholder="imprimer-les-documents" /></FormField>
      )}
    </fieldset>
  );
}
