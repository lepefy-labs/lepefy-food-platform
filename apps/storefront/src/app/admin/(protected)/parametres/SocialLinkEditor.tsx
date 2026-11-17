'use client';

import { useEffect, useState } from 'react';
import { IconArrowLeft, IconCircleCheck, IconSparkles } from '@tabler/icons-react';
import { SOCIAL_PLATFORM_REGISTRY, type SocialPlatform, type TenantSocialLink } from '@lepefy/types';
import Button from '../../_components/ui/Button';
import { Drawer } from '../../_components/ui/Dialog';
import { useConfirm, useUnsavedChangesGuard } from '../../_components/ui/ConfirmDialog';
import { FormField, Input } from '../../_components/ui/Form';
import { ErrorText } from '../../_components/ui/InlineAlert';
import { normalizeSocialUrl, socialUrlExample } from '@/lib/social/socialLinkUrl';
import { SocialPlatformBadge } from './SocialPlatformBadge';

export const SOCIAL_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'];

export type SocialLinkEditorTarget = { mode: 'create' } | { mode: 'edit'; link: TenantSocialLink };

interface SocialLinkEditorProps {
  target: SocialLinkEditorTarget | null;
  usedPlatforms: SocialPlatform[];
  onClose: () => void;
  /** Saves the normalised URL; resolves to an error message, or null on success. */
  onSave: (platform: SocialPlatform, url: string) => Promise<string | null>;
}

export function SocialLinkEditor({ target, usedPlatforms, onClose, onSave }: SocialLinkEditorProps) {
  const [platform, setPlatform] = useState<SocialPlatform | null>(null);
  const [input, setInput] = useState('');
  const [initialInput, setInitialInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();

  useEffect(() => {
    setTouched(false);
    setSaveError(null);
    if (target?.mode === 'edit') {
      setPlatform(target.link.platform);
      setInput(target.link.url);
      setInitialInput(target.link.url);
    } else {
      setPlatform(null);
      setInput('');
      setInitialInput('');
    }
  }, [target]);

  const isEdit = target?.mode === 'edit';
  const label = platform ? SOCIAL_PLATFORM_REGISTRY[platform].label : '';
  const result = platform && input.trim() ? normalizeSocialUrl(platform, input, label) : null;
  // An unchanged link that still carries tracking parameters can be saved (cleaned).
  const dirty = platform !== null && (input.trim() !== initialInput.trim() || Boolean(isEdit && result?.ok && result.url !== initialInput));
  const guardDialog = useUnsavedChangesGuard(dirty && input.trim() !== initialInput.trim(), 'Le lien saisi sera perdu.');
  const error = touched && platform ? (result && !result.ok ? result.error : !input.trim() ? 'Collez le lien de votre page.' : null) : null;

  async function requestClose() {
    if (saving) return;
    if (dirty && !(await ask({ title: 'Quitter sans enregistrer ?', description: 'Le lien saisi sera perdu.', confirmLabel: 'Quitter sans enregistrer', cancelLabel: 'Continuer', destructive: true }))) return;
    onClose();
  }

  async function submit() {
    setTouched(true);
    if (!platform || !result?.ok) return;
    setSaving(true);
    setSaveError(null);
    const failure = await onSave(platform, result.url);
    setSaving(false);
    if (failure) setSaveError(failure);
  }

  return (
    <>
      <Drawer
        open={target !== null}
        onClose={() => { void requestClose(); }}
        dismissible={!saving}
        title={isEdit ? `Modifier ${label}` : 'Ajouter un réseau social'}
        description={isEdit ? 'Le lien est vérifié et nettoyé avant l’enregistrement.' : platform ? 'Étape 2 sur 2 · Lien de votre page' : 'Étape 1 sur 2 · Choisissez le réseau'}
        footer={platform ? (
          <>
            {dirty && <span className="self-center text-xs font-medium text-tone-warning-fg sm:mr-auto">Modifications non enregistrées</span>}
            <Button variant="secondary" onClick={() => { void requestClose(); }} disabled={saving}>Annuler</Button>
            <Button onClick={() => { void submit(); }} loading={saving} disabled={isEdit && !dirty}>{isEdit ? 'Enregistrer' : 'Ajouter'}</Button>
          </>
        ) : undefined}
      >
        {!platform && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {SOCIAL_PLATFORMS.map((p) => {
              const taken = usedPlatforms.includes(p);
              return (
                <li key={p}>
                  <button
                    type="button"
                    disabled={taken}
                    onClick={() => setPlatform(p)}
                    className="flex w-full items-center gap-3 rounded-xl border border-a-border bg-a-surface p-3 text-left transition hover:border-a-brand hover:bg-a-brand-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-a-border disabled:hover:bg-a-surface"
                  >
                    <SocialPlatformBadge platform={p} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-a-text">{SOCIAL_PLATFORM_REGISTRY[p].label}</span>
                      {taken && <span className="block text-xs text-a-text-3">Déjà ajouté</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {platform && (
          <form className="space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="flex items-center gap-3 rounded-xl border border-a-border bg-a-surface-2 p-3">
              <SocialPlatformBadge platform={platform} size="sm" />
              <p className="min-w-0 flex-1 text-sm font-semibold text-a-text">{label}</p>
              {!isEdit && (
                <Button variant="ghost" size="sm" onClick={() => { setPlatform(null); setInput(''); setTouched(false); }}>
                  <IconArrowLeft size={14} aria-hidden="true" /> Changer
                </Button>
              )}
            </div>

            <FormField
              label="Lien de votre page"
              required
              error={error}
              hint={`Collez le lien depuis l’application ou le navigateur${platform !== 'linkedin' ? ', ou écrivez simplement @votrenom' : ''}. Ex. ${socialUrlExample(platform)}`}
            >
              <Input
                value={input}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={socialUrlExample(platform)}
                onChange={(e) => setInput(e.target.value)}
                onBlur={() => setTouched(true)}
                autoFocus={!isEdit}
              />
            </FormField>

            {result?.ok && (
              <div className="rounded-xl border border-tone-success-border bg-tone-success-bg px-3 py-2.5 text-xs leading-5 text-tone-success-fg">
                <p className="flex items-center gap-1.5 font-semibold">
                  {result.cleaned ? <IconSparkles size={14} aria-hidden="true" /> : <IconCircleCheck size={14} aria-hidden="true" />}
                  {result.cleaned ? 'Lien nettoyé : paramètres de suivi retirés' : 'Lien valide'}
                </p>
                <p className="mt-1 break-all">Sera enregistré : <a href={result.url} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">{result.url}</a></p>
              </div>
            )}

            <ErrorText message={saveError} />
            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">Enregistrer</button>
          </form>
        )}
      </Drawer>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
