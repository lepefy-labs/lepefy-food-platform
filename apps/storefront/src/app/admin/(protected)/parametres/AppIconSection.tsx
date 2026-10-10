'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { IconPhotoUp, IconTrash } from '@tabler/icons-react';
import { buildPwaIconPath, getAppIconRevision } from '@/lib/tenant/appIcon';
import Button from '../../_components/ui/Button';
import { SettingsPanel, SETTINGS_OUTLINE_DARK_CLS } from './_components/SettingsUi';

interface Props { initialAppIconUrl: string | null; hasLogoFallback: boolean; }
type Feedback = { type: 'success' | 'error'; message: string } | null;

export function AppIconSection({ initialAppIconUrl, hasLogoFallback }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [appIconUrl, setAppIconUrl] = useState(initialAppIconUrl);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const revision = `${getAppIconRevision(appIconUrl) ?? 'fallback'}-${previewRevision}`;
  const canPreview = Boolean(appIconUrl || hasLogoFallback);

  async function upload(file: File) {
    setFeedback(null);
    if (file.type !== 'image/png') return setFeedback({ type: 'error', message: 'Sélectionnez un fichier PNG.' });
    if (file.size > 1024 * 1024) return setFeedback({ type: 'error', message: 'Le fichier ne doit pas dépasser 1 Mo.' });

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch('/api/admin/app-icon', { method: 'POST', body: formData });
      const data = await response.json().catch(() => null) as { appIconUrl?: string; error?: string } | null;
      if (!response.ok || !data?.appIconUrl) throw new Error(data?.error ?? 'Échec de l’envoi.');
      setAppIconUrl(data.appIconUrl);
      setPreviewRevision(value => value + 1);
      setFeedback({ type: 'success', message: 'Icône de l’application mise à jour.' });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Échec de l’envoi.' });
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  async function remove() {
    setFeedback(null);
    setIsRemoving(true);
    try {
      const response = await fetch('/api/admin/app-icon', { method: 'DELETE' });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? 'Échec de la réinitialisation.');
      setAppIconUrl(null);
      setPreviewRevision(value => value + 1);
      setFeedback({ type: 'success', message: 'Le logo de la boutique est de nouveau utilisé.' });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'Échec de la réinitialisation.' });
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <SettingsPanel
      id="icone-application"
      title="Icône de l’application"
      description="Utilisée lorsque la boutique est installée sur un téléphone et pour les versions Android."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="text-sm font-medium text-a-text">{appIconUrl ? 'Icône dédiée configurée' : hasLogoFallback ? 'Le logo de la boutique est utilisé actuellement' : 'Aucune icône disponible'}</p>
          <ul className="mt-3 space-y-1 text-sm leading-6 text-a-text-3"><li>PNG carré, exactement 512 × 512 px</li><li>1 Mo maximum</li><li>Éléments importants centrés dans la zone sûre maskable</li></ul>
          {feedback && <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm font-medium ${feedback.type === 'success' ? 'text-tone-success-fg' : 'text-tone-danger-fg'}`}>{feedback.message}</p>}
          <input ref={inputRef} type="file" accept="image/png" onChange={handleFileChange} className="sr-only" aria-label="Choisir une icône PNG 512 par 512 pixels" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" loading={isUploading} disabled={isRemoving} onClick={() => inputRef.current?.click()} className="min-h-11"><IconPhotoUp size={17} />{appIconUrl ? 'Remplacer' : 'Importer'}</Button>
            {appIconUrl && <Button type="button" variant="outline" loading={isRemoving} disabled={isUploading} onClick={() => void remove()} className={`min-h-11 ${SETTINGS_OUTLINE_DARK_CLS}`}><IconTrash size={17} />Revenir au logo</Button>}
          </div>
        </div>
        {canPreview && <div className="flex items-end gap-4 self-start rounded-xl border border-a-border bg-a-surface-2 p-4">
          <figure className="text-center">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={buildPwaIconPath(192, 'any', revision)} alt="Aperçu de l’icône standard" width={96} height={96} className="h-24 w-24 rounded-2xl object-contain shadow-sm" /><figcaption className="mt-2 text-xs text-a-text-3">Standard</figcaption></figure>
          <figure className="text-center">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={buildPwaIconPath(512, 'maskable', revision)} alt="Aperçu de l’icône maskable" width={96} height={96} className="h-24 w-24 rounded-full object-contain shadow-sm" /><figcaption className="mt-2 text-xs text-a-text-3">Maskable</figcaption></figure>
        </div>}
      </div>
    </SettingsPanel>
  );
}
