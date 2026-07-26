'use client';

import { useRef, useState } from 'react';
import { IconUpload, IconPhoto } from '@tabler/icons-react';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface OriginSectionProps {
  tenantId: string;
  story_heading: string | null;
  story_text: string | null;
  story_image_url: string | null;
  countries_served: number | null;
}

export function OriginSection({
  tenantId,
  story_heading,
  story_text,
  story_image_url,
  countries_served,
}: OriginSectionProps) {
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

      const res = await fetch('/api/admin/upload-story-photo', {
        method: 'POST',
        body: uploadData,
      });
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
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Notre origine</h2>
      <p className="text-xs text-gray-400 mb-4">
        Ces contenus apparaissent dans une section dédiée de la page d&apos;accueil,
        visible uniquement si le texte est renseigné.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-4">
        <div>
          <label className={LABEL_CLS}>Titre</label>
          <input
            type="text"
            value={form.story_heading}
            onChange={(e) => setForm({ ...form, story_heading: e.target.value })}
            className={INPUT_CLS}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Texte</label>
          <textarea
            value={form.story_text}
            onChange={(e) => setForm({ ...form, story_text: e.target.value })}
            rows={5}
            className={`${INPUT_CLS} resize-none`}
          />
        </div>

        <div>
          <label className={LABEL_CLS}>Pays desservis</label>
          <input
            type="number"
            min="0"
            value={form.countries_served}
            onChange={(e) => setForm({ ...form, countries_served: e.target.value })}
            className={INPUT_CLS}
          />
          <p className="text-xs text-gray-400 mt-1">
            Laissez vide si non confirmé — n&apos;affichez pas un chiffre non vérifié.
          </p>
        </div>

        <div>
          <label className={LABEL_CLS}>Photo</label>

          <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-gray-100 mb-3">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Notre origine" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                <IconPhoto size={32} className="text-gray-300" />
                <span className="text-xs text-gray-400">Aucune image</span>
              </div>
            )}
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <IconUpload size={20} className="mx-auto mb-1 text-gray-400" />
            <p className="text-xs text-gray-500">
              {isUploading ? 'Envoi...' : 'Glisser une image ici'}
            </p>
            <span className="text-xs text-gray-400">ou cliquer pour parcourir</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="px-3 py-1.5 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
      >
        Enregistrer
      </button>
    </section>
  );
}
