'use client';

import { useRef, useState, useEffect } from 'react';
import {
  IconPhoto,
  IconUpload,
  IconSparkles,
  IconCheck,
  IconX,
} from '@tabler/icons-react';

interface ProductEditProps {
  product: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    price: number;
    weight_grams: number | null;
    stock: number;
    active: boolean;
    featured: boolean;
    storage_type: string;
    image_url: string | null;
    warehouse_location: string | null;
    category_id: string;
  };
  categories: { id: string; name: string; slug: string }[];
  tenantId: string;
  tenantCurrency: string;
  aiEnabled: boolean;
}

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

export default function ProductEditClient({
  product,
  categories,
  aiEnabled,
}: ProductEditProps) {
  const [imageUrl, setImageUrl]         = useState(product.image_url);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [isDragging, setIsDragging]     = useState(false);
  const [active, setActive]             = useState(product.active);
  const [featured, setFeatured]         = useState(product.featured);
  const [toast, setToast]               = useState<{
    msg: string;
    type: 'success' | 'error';
  } | null>(null);

  const fileInputRef        = useRef<HTMLInputElement>(null);
  const nameRef             = useRef<HTMLInputElement>(null);
  const descriptionRef      = useRef<HTMLTextAreaElement>(null);
  const priceRef            = useRef<HTMLInputElement>(null);
  const weightRef           = useRef<HTMLInputElement>(null);
  const stockRef            = useRef<HTMLInputElement>(null);
  const storageTypeRef      = useRef<HTMLSelectElement>(null);
  const categoryRef         = useRef<HTMLSelectElement>(null);
  const warehouseRef        = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const body = {
        name:               nameRef.current?.value ?? '',
        description:        descriptionRef.current?.value ?? '',
        price:              priceRef.current?.value ?? '0',
        weight_grams:       weightRef.current?.value ?? '',
        stock:              stockRef.current?.value ?? '0',
        active,
        featured,
        storage_type:       storageTypeRef.current?.value ?? 'dry',
        category_id:        categoryRef.current?.value ?? product.category_id,
        warehouse_location: warehouseRef.current?.value ?? '',
      };

      const res = await fetch(`/api/admin/catalogue/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Erreur lors de l\'enregistrement');
      showToast('Produit enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGenerateAI() {
    setIsGenerating(true);
    try {
      const currentCategoryId = categoryRef.current?.value ?? product.category_id;
      const currentCategory   = categories.find(c => c.id === currentCategoryId);

      const res = await fetch('/api/admin/generate-product-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId:    product.id,
          productName:  product.name,
          categorySlug: currentCategory?.slug ?? '',
          prompt:
            `Professional food photography of "${product.name}" from Cameroon, ` +
            `African specialty food, commercial e-commerce style, ` +
            `white background, studio lighting, sharp focus`,
        }),
      });

      if (!res.ok) throw new Error('Génération échouée');
      const { imageUrl: newUrl } = await res.json() as { imageUrl: string };
      setImageUrl(newUrl);
      showToast('Image générée avec succès', 'success');
    } catch {
      showToast('Erreur lors de la génération', 'error');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleFileUpload(file: File) {
    const localUrl = URL.createObjectURL(file);
    setImageUrl(localUrl);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('productId', product.id);
      formData.append('slug', product.slug);

      const res = await fetch('/api/admin/upload-product-image', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload échoué');
      const { imageUrl: uploadedUrl } = await res.json() as { imageUrl: string };
      setImageUrl(uploadedUrl);
      showToast('Image mise à jour', 'success');
    } catch {
      showToast('Erreur lors de l\'upload', 'error');
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFileUpload(file);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{product.name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            slug: <span className="font-mono">{product.slug}</span>
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <IconCheck size={16} />
          {isSaving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Card: Informations */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Informations</h2>

            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>Nom du produit</label>
                <input
                  ref={nameRef}
                  type="text"
                  defaultValue={product.name}
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className={LABEL_CLS}>Catégorie</label>
                <select
                  ref={categoryRef}
                  defaultValue={product.category_id}
                  className={INPUT_CLS}
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL_CLS}>Type de stockage</label>
                <select
                  ref={storageTypeRef}
                  defaultValue={product.storage_type}
                  className={INPUT_CLS}
                >
                  <option value="dry">Sec</option>
                  <option value="fresh">Frais</option>
                  <option value="frozen">Surgelé</option>
                </select>
              </div>

              <div>
                <label className={LABEL_CLS}>Description</label>
                <textarea
                  ref={descriptionRef}
                  defaultValue={product.description ?? ''}
                  rows={4}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
            </div>
          </section>

          {/* Card: Tarification & Logistique */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">
              Tarification &amp; Logistique
            </h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={LABEL_CLS}>Prix (€)</label>
                <input
                  ref={priceRef}
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={product.price.toFixed(2)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Poids (grammes)</label>
                <input
                  ref={weightRef}
                  type="number"
                  min="0"
                  defaultValue={product.weight_grams ?? ''}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Emplacement magasin</label>
              <input
                ref={warehouseRef}
                type="text"
                placeholder="ex: Corsia A - Ripiano 2"
                defaultValue={product.warehouse_location ?? ''}
                className={INPUT_CLS}
              />
            </div>
          </section>
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Card: Médias */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Médias</h2>

            {/* Preview */}
            <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-100 mb-4">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <IconPhoto size={32} className="text-gray-300" />
                  <span className="text-xs text-gray-400">Aucune image</span>
                </div>
              )}

              {isGenerating && (
                <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center gap-3">
                  <div className="w-7 h-7 border-2 border-[var(--color-primary-light)] border-t-[var(--color-primary)] rounded-full animate-spin" />
                  <p className="text-xs text-[var(--color-primary)] font-medium">
                    Génération en cours...
                  </p>
                </div>
              )}
            </div>

            {/* Drag & Drop area */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-4 text-center mb-3 transition-colors cursor-pointer ${
                isDragging
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <IconUpload size={20} className="mx-auto mb-1 text-gray-400" />
              <p className="text-xs text-gray-500">Glisser une image ici</p>
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

            {/* AI button — only when feature-flagged */}
            {aiEnabled && (
              <>
                <button
                  onClick={handleGenerateAI}
                  disabled={isGenerating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <IconSparkles size={16} stroke={2} />
                  Générer avec l&apos;IA
                </button>
                <p className="text-xs text-gray-400 text-center mt-2">
                  Photo générée automatiquement via IA
                </p>
              </>
            )}
          </section>

          {/* Card: Statut */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Statut</h2>

            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-900">Actif</p>
                <p className="text-xs text-gray-400">Visible en boutique</p>
              </div>
              <button
                onClick={() => setActive(!active)}
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  active ? 'bg-[var(--color-primary)]' : 'bg-gray-200'
                }`}
                aria-label="Activer le produit"
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                    active ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-gray-900">En vedette</p>
                <p className="text-xs text-gray-400">Affiché en homepage</p>
              </div>
              <button
                onClick={() => setFeatured(!featured)}
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  featured ? 'bg-[var(--color-primary)]' : 'bg-gray-200'
                }`}
                aria-label="Mettre en vedette"
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                    featured ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Card: Stock */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Stock</h2>
            <div>
              <label className={LABEL_CLS}>Quantité disponible</label>
              <input
                ref={stockRef}
                type="number"
                min={0}
                defaultValue={product.stock}
                className={INPUT_CLS}
              />
            </div>
          </section>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
            toast.type === 'success' ? 'bg-[var(--color-primary)]' : 'bg-red-500'
          }`}
        >
          {toast.type === 'success' ? <IconCheck size={16} /> : <IconX size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
