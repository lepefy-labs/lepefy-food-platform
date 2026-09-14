'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import {
  IconArrowLeft,
  IconArrowRight,
  IconPhoto,
  IconSparkles,
  IconStar,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import type { ProductImage } from '@lepefy/types';
import {
  MAX_PRODUCT_IMAGES,
  moveProductImage,
  normalizeProductImages,
} from '@/lib/catalog/productImages';
import Button from '../../../_components/ui/Button';
import ConfirmActionModal from '../../../_components/ui/ConfirmActionModal';

const MAX_UPLOAD_FILE_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_EDGE = 1600;
const UPLOAD_WEBP_QUALITY = 0.92;

async function optimizeImageForUpload(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_UPLOAD_EDGE / bitmap.width, MAX_UPLOAD_EDGE / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));

      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const optimized = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', UPLOAD_WEBP_QUALITY);
      });
      if (!optimized || optimized.size >= file.size) return file;

      const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
      return new File([optimized], baseName + '.webp', {
        type: 'image/webp',
        lastModified: file.lastModified,
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

interface ProductMediaManagerProps {
  productId: string;
  productName: string;
  productSlug: string;
  categorySlug: string;
  categoryName: string;
  initialImageUrl: string | null;
  initialImages: ProductImage[];
  aiEnabled: boolean;
  isNew: boolean;
  onChange: (imageUrl: string | null, images: ProductImage[]) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export default function ProductMediaManager({
  productId,
  productName,
  productSlug,
  categorySlug,
  categoryName,
  initialImageUrl,
  initialImages,
  aiEnabled,
  isNew,
  onChange,
  onToast,
}: ProductMediaManagerProps) {
  const [images, setImages] = useState<ProductImage[]>(() =>
    normalizeProductImages(initialImages, initialImageUrl, productName),
  );
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProductImage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const remaining = MAX_PRODUCT_IMAGES - images.length;

  function applyGallery(next: ProductImage[]) {
    const normalized = normalizeProductImages(next);
    setImages(normalized);
    onChange(normalized[0]?.url ?? null, normalized);
  }

  async function persistGallery(next: ProductImage[], successMessage: string) {
    setIsSavingOrder(true);
    try {
      const res = await fetch('/api/admin/catalogue/' + productId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: next,
          image_url: next[0]?.url ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Mise à jour impossible');
      }
      applyGallery(next);
      onToast(successMessage, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Mise à jour impossible', 'error');
    } finally {
      setIsSavingOrder(false);
    }
  }

  async function handleFiles(fileList: FileList | File[]) {
    const selected = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    if (selected.length === 0) return;
    if (selected.length > remaining) {
      onToast('Vous pouvez encore ajouter ' + remaining + ' image(s)', 'error');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: selected.length });
    try {
      const optimizedFiles = await Promise.all(selected.map(optimizeImageForUpload));
      const oversized = optimizedFiles.find((file) => file.size > MAX_UPLOAD_FILE_BYTES);
      if (oversized) {
        throw new Error(oversized.name + ' dépasse la limite de 4 Mo après optimisation');
      }

      for (const [index, file] of optimizedFiles.entries()) {
        setUploadProgress({ current: index + 1, total: optimizedFiles.length });

        const uploadData = new FormData();
        uploadData.append('files', file);
        uploadData.append('productId', productId);
        uploadData.append('slug', productSlug);
        if (removeBackground) uploadData.append('removeBackground', 'true');

        const res = await fetch('/api/admin/upload-product-image', {
          method: 'POST',
          body: uploadData,
        });
        const data = await res.json().catch(() => ({
          error: res.status === 413
            ? 'Image trop volumineuse pour le téléversement'
            : 'Réponse serveur invalide',
        })) as {
          images?: ProductImage[];
          imageUrl?: string | null;
          error?: string;
        };
        if (!res.ok || !data.images) throw new Error(data.error || 'Téléversement échoué');

        applyGallery(data.images);
      }

      onToast(selected.length > 1 ? 'Images ajoutées' : 'Image ajoutée', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Téléversement échoué', 'error');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleGenerateAI() {
    if (remaining === 0) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/admin/generate-product-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          productName,
          productSlug,
          categorySlug,
          categoryName,
        }),
      });
      const data = await res.json() as { imageUrl?: string; images?: ProductImage[]; error?: string };
      if (!res.ok || !data.imageUrl || !data.images) throw new Error(data.error || 'Génération échouée');

      applyGallery(data.images);
      onToast('Image générée et définie comme principale', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Génération échouée', 'error');
    } finally {
      setIsGenerating(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch('/api/admin/upload-product-image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, imageUrl: pendingDelete.url }),
      });
      const data = await res.json() as { images?: ProductImage[]; error?: string };
      if (!res.ok || !data.images) throw new Error(data.error || 'Suppression impossible');

      applyGallery(data.images);
      setPendingDelete(null);
      onToast('Image supprimée', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Suppression impossible', 'error');
    } finally {
      setIsDeleting(false);
    }
  }

  if (isNew) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Médias</h2>
        <p className="text-xs text-gray-400">
          Enregistrez d’abord le produit pour ajouter sa galerie d’images.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Médias</h2>
            <p className="mt-1 text-xs text-gray-400">
              {images.length} / {MAX_PRODUCT_IMAGES} images · la première est utilisée comme couverture
            </p>
          </div>
          {remaining > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              <IconUpload size={16} aria-hidden="true" />
              Ajouter
            </Button>
          )}
        </div>

        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image, index) => (
              <div
                key={image.url}
                className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
              >
                <Image
                  src={image.url}
                  alt={image.alt || productName}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 45vw, 180px"
                />
                {index === 0 && (
                  <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-gray-800 shadow-sm">
                    Principale
                  </span>
                )}
                <div className="absolute inset-x-2 bottom-2 flex items-center justify-end gap-1">
                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => void persistGallery(
                        moveProductImage(images, index, index - 1),
                        index === 1 ? 'Image définie comme principale' : 'Ordre mis à jour',
                      )}
                      disabled={isSavingOrder}
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/95 text-gray-700 shadow-sm transition-colors hover:text-[var(--color-primary)] disabled:opacity-50"
                      aria-label={index === 1 ? 'Définir comme image principale' : 'Déplacer vers la gauche'}
                    >
                      {index === 1 ? <IconStar size={17} aria-hidden="true" /> : <IconArrowLeft size={17} aria-hidden="true" />}
                    </button>
                  )}
                  {index < images.length - 1 && index > 0 && (
                    <button
                      type="button"
                      onClick={() => void persistGallery(
                        moveProductImage(images, index, index + 1),
                        'Ordre mis à jour',
                      )}
                      disabled={isSavingOrder}
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/95 text-gray-700 shadow-sm transition-colors hover:text-[var(--color-primary)] disabled:opacity-50"
                      aria-label="Déplacer vers la droite"
                    >
                      <IconArrowRight size={17} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(image)}
                    disabled={isSavingOrder}
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/95 text-red-500 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-50"
                    aria-label={'Supprimer l’image ' + (index + 1)}
                  >
                    <IconTrash size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-lg bg-gray-100 text-gray-400">
            <IconPhoto size={32} aria-hidden="true" />
            <span className="text-xs">Aucune image</span>
          </div>
        )}

        {remaining > 0 && (
          <>
            <label className="mb-2 mt-4 flex cursor-pointer items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={removeBackground}
                onChange={(event) => setRemoveBackground(event.target.checked)}
                className="rounded border-gray-300"
              />
              Supprimer le fond automatiquement (IA)
            </label>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                void handleFiles(event.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={
                'cursor-pointer rounded-lg border-2 border-dashed p-4 text-center transition-colors ' +
                (isDragging
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                  : 'border-gray-200 hover:border-gray-300')
              }
            >
              <IconUpload size={20} className="mx-auto mb-1 text-gray-400" aria-hidden="true" />
              <p className="text-xs text-gray-500">
                {isUploading && uploadProgress
                  ? uploadProgress.current === 0
                    ? 'Optimisation des images…'
                    : 'Téléversement ' + uploadProgress.current + ' / ' + uploadProgress.total + '…'
                  : 'Glisser une ou plusieurs images ici'}
              </p>
              <span className="text-xs text-gray-400">
                ou cliquer pour parcourir · {remaining} emplacement(s) disponible(s)
              </span>
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
          }}
        />

        {aiEnabled && remaining > 0 && (
          <>
            <Button
              type="button"
              onClick={() => void handleGenerateAI()}
              loading={isGenerating}
              disabled={isUploading || isSavingOrder}
              className="mt-3 w-full"
            >
              {!isGenerating && <IconSparkles size={16} aria-hidden="true" />}
              Générer avec l’IA
            </Button>
            <p className="mt-2 text-center text-xs text-gray-400">
              L’image générée devient la couverture de la galerie
            </p>
          </>
        )}
      </section>

      <ConfirmActionModal
        open={Boolean(pendingDelete)}
        title="Supprimer cette image ?"
        description={
          pendingDelete?.url === images[0]?.url
            ? 'La deuxième image deviendra automatiquement la couverture du produit.'
            : 'Cette image sera retirée définitivement de la galerie.'
        }
        confirmLabel="Supprimer"
        cancelLabel="Conserver"
        loading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
