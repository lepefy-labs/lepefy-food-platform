'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { IconDeviceMobile, IconPhotoUp, IconTrash } from '@tabler/icons-react';
import { buildPwaIconPath, getAppIconRevision } from '@/lib/tenant/appIcon';
import Button from '../../_components/ui/Button';

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
    <section className="overflow-hidden rounded-2xl border border-[#E8E4FF] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-[#E8E4FF] bg-[var(--admin-primary-soft)] px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[var(--admin-primary-fg)] shadow-sm dark:bg-gray-800"><IconDeviceMobile size={19} stroke={1.7} /></div>
        <div><h2 className="text-sm font-semibold text-[var(--admin-primary-fg)] dark:text-violet-200">Icône de l’application</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Utilisée lorsque la boutique est installée sur un téléphone et pour les versions Android.</p></div>
      </header>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{appIconUrl ? 'Icône dédiée configurée' : hasLogoFallback ? 'Le logo de la boutique est utilisé actuellement' : 'Aucune icône disponible'}</p>
          <ul className="mt-3 space-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400"><li>PNG carré, exactement 512 × 512 px</li><li>1 Mo maximum</li><li>Éléments importants centrés dans la zone sûre maskable</li></ul>
          {feedback && <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg px-3 py-2 text-xs ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{feedback.message}</p>}
          <input ref={inputRef} type="file" accept="image/png" onChange={handleFileChange} className="sr-only" aria-label="Choisir une icône PNG 512 par 512 pixels" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" loading={isUploading} disabled={isRemoving} onClick={() => inputRef.current?.click()} className="min-h-11"><IconPhotoUp size={17} />{appIconUrl ? 'Remplacer' : 'Importer'}</Button>
            {appIconUrl && <Button type="button" variant="outline" loading={isRemoving} disabled={isUploading} onClick={() => void remove()} className="min-h-11"><IconTrash size={17} />Revenir au logo</Button>}
          </div>
        </div>
        {canPreview && <div className="flex items-end gap-4 rounded-xl border border-gray-200 bg-[var(--admin-surface-subtle)] p-4 dark:border-gray-800 dark:bg-gray-950/30">
          <figure className="text-center">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={buildPwaIconPath(192, 'any', revision)} alt="Aperçu de l’icône standard" width={96} height={96} className="h-24 w-24 rounded-2xl object-contain shadow-sm" /><figcaption className="mt-2 text-[11px] text-gray-500">Standard</figcaption></figure>
          <figure className="text-center">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={buildPwaIconPath(512, 'maskable', revision)} alt="Aperçu de l’icône maskable" width={96} height={96} className="h-24 w-24 rounded-full object-contain shadow-sm" /><figcaption className="mt-2 text-[11px] text-gray-500">Maskable</figcaption></figure>
        </div>}
      </div>
    </section>
  );
}
