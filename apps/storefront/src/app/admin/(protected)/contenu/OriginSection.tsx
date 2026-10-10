'use client';

import { useRef, useState } from 'react';
import { IconPhoto, IconUpload } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import { SettingsFeedback, SettingsPanel, SETTINGS_HINT_CLS, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from '../parametres/_components/SettingsUi';
import { useSettingsFeedback } from '../parametres/_components/useSettingsFeedback';

interface OriginSectionProps {
  tenantId: string;
  story_heading: string | null;
  story_text: string | null;
  story_image_url: string | null;
  countries_served: number | null;
}

/** "Notre origine" block of the storefront home (tenants.story_* / countries_served). */
export function OriginSection({ tenantId, story_heading, story_text, story_image_url, countries_served }: OriginSectionProps) {
  const [form, setForm] = useState({
    story_heading: story_heading ?? '',
    story_text: story_text ?? '',
    countries_served: countries_served != null ? String(countries_served) : '',
  });
  const [imageUrl, setImageUrl] = useState(story_image_url);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const { feedback, show: showToast } = useSettingsFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFileUpload(file: File) {
    setIsUploading(true);
    const localUrl = URL.createObjectURL(file);
    setImageUrl(localUrl);
    try {
      const uploadData = new FormData();
      uploadData.append('file', file);
      uploadData.append('tenantId', tenantId);
      const res = await fetch('/api/admin/upload-story-photo', { method: 'POST', body: uploadData });
      const data = await res.json() as { imageUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Upload échoué');
      setImageUrl(data.imageUrl ?? null);
      showToast('Photo mise à jour', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de l\'upload', 'error');
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFileUpload(file);
  }

  return (
    <SettingsPanel
      id="notre-origine"
      title="Notre origine"
      description="Histoire de la boutique affichée sur la page d’accueil."
      footer={<>
        <SettingsFeedback feedback={feedback} />
        <Button type="button" onClick={handleSave} loading={isSaving} className="min-h-11">Enregistrer</Button>
      </>}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div>
            <label htmlFor="story-heading" className={SETTINGS_LABEL_CLS}>Titre</label>
            <input id="story-heading" type="text" value={form.story_heading} onChange={(e) => setForm({ ...form, story_heading: e.target.value })} className={SETTINGS_INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="story-text" className={SETTINGS_LABEL_CLS}>Histoire courte</label>
            <textarea id="story-text" value={form.story_text} onChange={(e) => setForm({ ...form, story_text: e.target.value })} rows={6} className={`${SETTINGS_INPUT_CLS} resize-y`} />
          </div>
          <div className="max-w-[200px]">
            <label htmlFor="story-countries" className={SETTINGS_LABEL_CLS}>Pays desservis</label>
            <input id="story-countries" type="number" min="0" value={form.countries_served} onChange={(e) => setForm({ ...form, countries_served: e.target.value })} className={SETTINGS_INPUT_CLS} />
          </div>
        </div>

        <div>
          <p className={SETTINGS_LABEL_CLS}>Photo</p>
          <div className="mb-3 aspect-[16/9] w-full overflow-hidden rounded-xl bg-a-hover">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Photo « Notre origine »" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-a-text-3"><IconPhoto size={30} aria-hidden="true" /><span className="text-xs">Aucune image</span></div>
            )}
          </div>
          <button
            type="button"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={`w-full rounded-xl border-2 border-dashed p-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus ${isDragging ? 'border-a-border-strong bg-a-surface-2' : 'border-a-border hover:border-a-border-strong hover:bg-a-surface-2'}`}
          >
            <IconUpload size={19} aria-hidden="true" className="mx-auto mb-1 text-a-text-3" />
            <span className="text-sm text-a-text-2">{isUploading ? 'Envoi…' : 'Glisser une image ou cliquer pour parcourir'}</span>
          </button>
          <p className={SETTINGS_HINT_CLS}>La photo est enregistrée dès l’envoi.</p>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); }} />
        </div>
      </div>
    </SettingsPanel>
  );
}
