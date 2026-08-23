'use client';

import { useRef, useState } from 'react';
import { IconGlobe, IconPhoto, IconUpload } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';

const INPUT_CLS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300';

interface OriginSectionProps {
  tenantId: string;
  story_heading: string | null;
  story_text: string | null;
  story_image_url: string | null;
  countries_served: number | null;
}

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
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

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
    <section className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-blue-100 bg-blue-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300">
          <IconGlobe size={19} stroke={1.7} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-blue-700 dark:text-blue-200">Contenu public</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Origine, histoire et contenus de marque</p>
        </div>
      </header>

      <div className="p-4 sm:p-5">
        {toast && <div className={`mb-4 rounded-lg px-3 py-2 text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLS}>Titre</label>
            <input type="text" value={form.story_heading} onChange={(e) => setForm({ ...form, story_heading: e.target.value })} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Histoire courte</label>
            <textarea value={form.story_text} onChange={(e) => setForm({ ...form, story_text: e.target.value })} rows={5} className={`${INPUT_CLS} resize-none`} />
          </div>
          <div>
            <label className={LABEL_CLS}>Pays desservis</label>
            <input type="number" min="0" value={form.countries_served} onChange={(e) => setForm({ ...form, countries_served: e.target.value })} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Photo</label>
            <div className="mb-3 aspect-[16/9] w-full overflow-hidden rounded-xl bg-gray-100">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Notre origine" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400"><IconPhoto size={30} /><span className="text-xs">Aucune image</span></div>
              )}
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30'}`}
            >
              <IconUpload size={19} className="mx-auto mb-1 text-gray-400" />
              <p className="text-xs text-gray-600">{isUploading ? 'Envoi...' : 'Glisser une image ou cliquer pour parcourir'}</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); }} />
          </div>
        </div>
      </div>

      <footer className="flex justify-end border-t border-blue-100 bg-blue-50/30 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/80">
        <Button onClick={handleSave} loading={isSaving}>Enregistrer</Button>
      </footer>
    </section>
  );
}
