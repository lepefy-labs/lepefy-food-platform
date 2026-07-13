'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  IconPhoto,
  IconUpload,
  IconSparkles,
  IconCheck,
  IconX,
  IconTrash,
  IconTag,
} from '@tabler/icons-react';
import type { Producer, Importer, NutritionInfo, DurabilityType } from '@lepefy/types';

interface ProductEditProps {
  product: {
    id: string;
    name: string;
    name_alt: string | null;
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
    producer_id: string | null;
    importer_id: string | null;
    ingredients_text: string | null;
    allergens_text: string | null;
    gluten_free_certified: boolean;
    usage_instructions: string | null;
    conservation_instructions: string | null;
    conservation_after_opening: string | null;
    country_of_origin: string | null;
    durability_type: DurabilityType | null;
    quid_ingredient: string | null;
    quid_percentage: number | null;
    alcohol_pct: number | null;
    net_quantity_display: string | null;
    packaging_material: string | null;
    recycling_note: string | null;
    nutrition_basis: '100g' | '100ml';
    nutrition: NutritionInfo | null;
    label_background_image_url: string | null;
    label_background_color: string | null;
  };
  categories: { id: string; name: string; slug: string }[];
  producers: Producer[];
  importers: Importer[];
  tenantId: string;
  tenantCurrency: string;
  aiEnabled: boolean;
  isNew?: boolean;
  fromCategory?: string;
}

interface FormState {
  name: string;
  name_alt: string;
  description: string;
  price: string;
  weight_grams: string;
  stock: string;
  active: boolean;
  featured: boolean;
  storage_type: string;
  category_id: string;
  warehouse_location: string;
  image_url: string | null;
  producer_id: string;
  importer_id: string;
  ingredients_text: string;
  allergens_text: string;
  gluten_free_certified: boolean;
  usage_instructions: string;
  conservation_instructions: string;
  conservation_after_opening: string;
  country_of_origin: string;
  durability_type: DurabilityType | '';
  quid_ingredient: string;
  quid_percentage: string;
  alcohol_pct: string;
  net_quantity_display: string;
  packaging_material: string;
  recycling_note: string;
  nutrition_basis: '100g' | '100ml';
  nutrition: NutritionInfo;
  label_background_image_url: string | null;
  label_background_color: string;
}

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';
const SECTION_TITLE_CLS = 'text-sm font-semibold text-gray-700 mb-4';

const NUTRITION_FIELDS: { key: keyof NutritionInfo; label: string }[] = [
  { key: 'kcal',             label: 'Énergie (kcal)' },
  { key: 'kj',               label: 'Valeur énergétique (kJ)' },
  { key: 'fat_g',            label: 'Matières grasses (g)' },
  { key: 'saturated_fat_g',  label: 'dont acides gras saturés (g)' },
  { key: 'carbs_g',          label: 'Glucides (g)' },
  { key: 'sugars_g',         label: 'dont sucres (g)' },
  { key: 'fiber_g',          label: 'Fibres (g)' },
  { key: 'protein_g',        label: 'Protéines (g)' },
  { key: 'salt_g',           label: 'Sel (g)' },
];

function cleanNutrition(raw: NutritionInfo): NutritionInfo {
  const entries = Object.entries(raw).filter(
    ([, v]) => v !== undefined && v !== null && !Number.isNaN(v as number)
  );
  return Object.fromEntries(entries) as NutritionInfo;
}

function initFormState(product: ProductEditProps['product']): FormState {
  return {
    name:                        product.name,
    name_alt:                    product.name_alt ?? '',
    description:                 product.description ?? '',
    price:                       product.price.toFixed(2),
    weight_grams:                product.weight_grams != null ? String(product.weight_grams) : '',
    stock:                       String(product.stock),
    active:                      product.active,
    featured:                    product.featured,
    storage_type:                product.storage_type,
    category_id:                 product.category_id,
    warehouse_location:          product.warehouse_location ?? '',
    image_url:                   product.image_url,
    producer_id:                 product.producer_id ?? '',
    importer_id:                 product.importer_id ?? '',
    ingredients_text:            product.ingredients_text ?? '',
    allergens_text:              product.allergens_text ?? '',
    gluten_free_certified:       product.gluten_free_certified ?? false,
    usage_instructions:          product.usage_instructions ?? '',
    conservation_instructions:   product.conservation_instructions ?? '',
    conservation_after_opening:  product.conservation_after_opening ?? '',
    country_of_origin:           product.country_of_origin ?? '',
    durability_type:             product.durability_type ?? '',
    quid_ingredient:             product.quid_ingredient ?? '',
    quid_percentage:             product.quid_percentage != null ? String(product.quid_percentage) : '',
    alcohol_pct:                 product.alcohol_pct != null ? String(product.alcohol_pct) : '',
    net_quantity_display:        product.net_quantity_display ?? '',
    packaging_material:          product.packaging_material ?? '',
    recycling_note:              product.recycling_note ?? '',
    nutrition_basis:             product.nutrition_basis ?? '100g',
    nutrition:                   product.nutrition ?? {},
    label_background_image_url:  product.label_background_image_url,
    label_background_color:      product.label_background_color ?? '',
  };
}

export default function ProductEditClient({
  product,
  categories,
  producers,
  importers,
  aiEnabled,
  isNew = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fromCategory,
}: ProductEditProps) {
  const [activeTab, setActiveTab]       = useState<'generale' | 'etichetta'>('generale');
  const [formData, setFormData]         = useState<FormState>(() => initFormState(product));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving]         = useState(false);
  const [isDragging, setIsDragging]     = useState(false);
  const [isDraggingLabelBg, setIsDraggingLabelBg]   = useState(false);
  const [isUploadingLabelBg, setIsUploadingLabelBg] = useState(false);
  const [toast, setToast]               = useState<{
    msg: string;
    type: 'success' | 'error';
  } | null>(null);

  const fileInputRef        = useRef<HTMLInputElement>(null);
  const labelBgFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function updateNutrition(key: keyof NutritionInfo, raw: string) {
    setFormData((prev) => {
      const nextNutrition = { ...prev.nutrition };
      if (raw === '') {
        delete nextNutrition[key];
      } else {
        const num = parseFloat(raw);
        if (Number.isNaN(num)) delete nextNutrition[key];
        else nextNutrition[key] = num;
      }
      return { ...prev, nutrition: nextNutrition };
    });
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const body = {
        name:               formData.name,
        name_alt:           formData.name_alt,
        description:        formData.description,
        price:              formData.price,
        weight_grams:       formData.weight_grams,
        stock:              formData.stock,
        active:             formData.active,
        featured:           formData.featured,
        storage_type:       formData.storage_type,
        category_id:        formData.category_id,
        warehouse_location: formData.warehouse_location,
        image_url:          formData.image_url,

        producer_id:                 formData.producer_id || null,
        importer_id:                 formData.importer_id || null,
        ingredients_text:            formData.ingredients_text,
        allergens_text:              formData.allergens_text,
        gluten_free_certified:       formData.gluten_free_certified,
        usage_instructions:          formData.usage_instructions,
        conservation_instructions:   formData.conservation_instructions,
        conservation_after_opening:  formData.conservation_after_opening,
        country_of_origin:           formData.country_of_origin,
        durability_type:             formData.durability_type || null,
        quid_ingredient:              formData.quid_ingredient,
        quid_percentage:              formData.quid_percentage,
        alcohol_pct:                  formData.alcohol_pct,
        net_quantity_display:         formData.net_quantity_display,
        packaging_material:           formData.packaging_material,
        recycling_note:               formData.recycling_note,
        nutrition_basis:              formData.nutrition_basis,
        nutrition:                    cleanNutrition(formData.nutrition),
        label_background_image_url:   formData.label_background_image_url,
        label_background_color:       formData.label_background_color || null,
      };

      const method   = isNew ? 'POST' : 'PATCH';
      const endpoint = isNew
        ? '/api/admin/catalogue'
        : `/api/admin/catalogue/${product.id}`;

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Erreur lors de l\'enregistrement');

      if (isNew) {
        const { id } = await res.json() as { id: string };
        window.location.href = `/admin/catalogue/${id}`;
      } else {
        showToast('Produit enregistré', 'success');
      }
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGenerateAI() {
    setIsGenerating(true);
    try {
      const currentCategory = categories.find(c => c.id === formData.category_id);

      const res = await fetch('/api/admin/generate-product-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId:    product.id,
          productName:  product.name,
          productSlug:  product.slug,
          categorySlug: currentCategory?.slug ?? '',
          categoryName: currentCategory?.name ?? '',
        }),
      });

      if (!res.ok) {
        const { error } = await res.json() as { error?: string };
        throw new Error(error ?? 'Génération échouée');
      }

      const { imageUrl: newUrl } = await res.json() as { imageUrl: string };
      setField('image_url', newUrl);
      showToast('Image générée avec succès', 'success');
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Erreur lors de la génération';
      showToast(message, 'error');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleFileUpload(file: File) {
    const localUrl = URL.createObjectURL(file);
    setField('image_url', localUrl);

    try {
      const uploadData = new FormData();
      uploadData.append('file', file);
      uploadData.append('productId', product.id);
      uploadData.append('slug', product.slug);

      const res = await fetch('/api/admin/upload-product-image', {
        method: 'POST',
        body: uploadData,
      });
      if (!res.ok) throw new Error('Upload échoué');
      const { imageUrl: uploadedUrl } = await res.json() as { imageUrl: string };
      setField('image_url', uploadedUrl);
      showToast('Image mise à jour', 'success');
    } catch {
      showToast('Erreur lors de l\'upload', 'error');
    }
  }

  async function handleDeleteImage() {
    setField('image_url', null);
    try {
      const res = await fetch(`/api/admin/catalogue/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: null }),
      });
      if (!res.ok) throw new Error('Erreur');
      showToast('Image supprimée', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFileUpload(file);
  }

  async function handleLabelBgUpload(file: File) {
    setIsUploadingLabelBg(true);
    const localUrl = URL.createObjectURL(file);
    setField('label_background_image_url', localUrl);

    try {
      const uploadData = new FormData();
      uploadData.append('file', file);
      uploadData.append('target', 'product-background');
      uploadData.append('entityId', product.id);

      const res = await fetch('/api/admin/upload-label-asset', {
        method: 'POST',
        body: uploadData,
      });
      const data = await res.json() as { assetUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Échec du téléversement');

      setField('label_background_image_url', data.assetUrl ?? null);
      showToast('Fond étiquette mis à jour', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de l\'upload', 'error');
    } finally {
      setIsUploadingLabelBg(false);
    }
  }

  function handleLabelBgDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingLabelBg(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleLabelBgUpload(file);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {isNew ? 'Nouveau produit' : product.name}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            slug: <span className="font-mono">{product.slug}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Link
              href={`/admin/products/${product.id}/etichetta`}
              className="border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <IconTag size={16} />
              Étiquette
            </Link>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <IconCheck size={16} />
            {isSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        <button
          onClick={() => setActiveTab('generale')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'generale'
              ? 'border-[var(--color-primary)] text-gray-900'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Général
        </button>
        <button
          onClick={() => setActiveTab('etichetta')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'etichetta'
              ? 'border-[var(--color-primary)] text-gray-900'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          Étiquette
        </button>
      </div>

      {/* ── Onglet Général ──────────────────────────────────────────────────── */}
      {/* Toujours monté (display:none quand inactif) pour ne jamais perdre l'état au changement d'onglet */}
      <div
        className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5"
        style={{ display: activeTab === 'generale' ? 'grid' : 'none' }}
      >

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Card: Informations */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className={SECTION_TITLE_CLS}>Informations</h2>

            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>Nom du produit</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setField('name', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className={LABEL_CLS}>Catégorie</label>
                <select
                  value={formData.category_id}
                  onChange={(e) => setField('category_id', e.target.value)}
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
                  value={formData.storage_type}
                  onChange={(e) => setField('storage_type', e.target.value)}
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
                  value={formData.description}
                  onChange={(e) => setField('description', e.target.value)}
                  rows={4}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
            </div>
          </section>

          {/* Card: Tarification & Logistique */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className={SECTION_TITLE_CLS}>
              Tarification &amp; Logistique
            </h2>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={LABEL_CLS}>Prix (€)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setField('price', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Poids (grammes)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.weight_grams}
                  onChange={(e) => setField('weight_grams', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Emplacement magasin</label>
              <input
                type="text"
                placeholder="ex: Corsia A - Ripiano 2"
                value={formData.warehouse_location}
                onChange={(e) => setField('warehouse_location', e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </section>
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Card: Médias */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className={SECTION_TITLE_CLS}>Médias</h2>

            {/* Preview */}
            <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-gray-100 mb-4">
              {formData.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={formData.image_url}
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
                <div className="absolute inset-0 bg-white/90 flex flex-col
                                items-center justify-center gap-3 rounded-lg">
                  <div className="w-8 h-8 border-2
                                  border-[var(--color-primary-light)]
                                  border-t-[var(--color-primary)]
                                  rounded-full animate-spin" />
                  <div className="text-center px-4">
                    <p className="text-xs font-medium text-[var(--color-primary)]">
                      Génération en cours...
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Analyse du produit puis création de l&apos;image
                    </p>
                    <p className="text-[10px] text-gray-300 mt-0.5">
                      (5 à 15 secondes)
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Delete button — only when image exists */}
            {formData.image_url && (
              <button
                onClick={handleDeleteImage}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors mt-2 mb-3"
              >
                <IconTrash size={14} />
                Supprimer l&apos;image
              </button>
            )}

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
            <h2 className={SECTION_TITLE_CLS}>Statut</h2>

            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-900">Actif</p>
                <p className="text-xs text-gray-400">Visible en boutique</p>
              </div>
              <button
                onClick={() => setField('active', !formData.active)}
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  formData.active ? 'bg-[var(--color-primary)]' : 'bg-gray-200'
                }`}
                aria-label="Activer le produit"
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                    formData.active ? 'right-1' : 'left-1'
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
                onClick={() => setField('featured', !formData.featured)}
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  formData.featured ? 'bg-[var(--color-primary)]' : 'bg-gray-200'
                }`}
                aria-label="Mettre en vedette"
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
                    formData.featured ? 'right-1' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Card: Stock */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className={SECTION_TITLE_CLS}>Stock</h2>
            <div>
              <label className={LABEL_CLS}>Quantité disponible</label>
              <input
                type="number"
                min={0}
                value={formData.stock}
                onChange={(e) => setField('stock', e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </section>
        </div>
      </div>

      {/* ── Onglet Étiquette ────────────────────────────────────────────────── */}
      {/* Toujours monté (display:none quand inactif) pour ne jamais perdre l'état au changement d'onglet */}
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-5"
        style={{ display: activeTab === 'etichetta' ? 'grid' : 'none' }}
      >

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Traduction du nom */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Traduction du nom</h3>
            <div>
              <label className={LABEL_CLS}>Nome in italiano / traduzione</label>
              <input
                type="text"
                value={formData.name_alt}
                onChange={(e) => setField('name_alt', e.target.value)}
                className={INPUT_CLS}
                placeholder="es. Pasta di manioca sotto vuoto"
              />
            </div>
          </section>

          {/* Producteur et importateur */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Producteur et importateur</h3>
            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>Producteur</label>
                <select
                  value={formData.producer_id}
                  onChange={(e) => setField('producer_id', e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">— Aucun —</option>
                  {producers.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Importateur</label>
                <select
                  value={formData.importer_id}
                  onChange={(e) => setField('importer_id', e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">— Aucun —</option>
                  {importers.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Ingrédients et allergènes */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Ingrédients et allergènes</h3>
            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>Ingrédients</label>
                <textarea
                  value={formData.ingredients_text}
                  onChange={(e) => setField('ingredients_text', e.target.value)}
                  rows={4}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Allergènes</label>
                <textarea
                  value={formData.allergens_text}
                  onChange={(e) => setField('allergens_text', e.target.value)}
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.gluten_free_certified}
                    onChange={(e) => setField('gluten_free_certified', e.target.checked)}
                    className="accent-[var(--color-primary)]"
                  />
                  Certifié sans gluten (nécessite analyse/certification)
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  Activez uniquement si une certification ou une analyse de laboratoire
                  existe. Ne vous basez pas sur le fait que les ingrédients soient
                  naturellement sans gluten — risque de contamination croisée.
                </p>
              </div>
            </div>
          </section>

          {/* Instructions */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Instructions</h3>
            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>Conseils d&apos;utilisation</label>
                <textarea
                  value={formData.usage_instructions}
                  onChange={(e) => setField('usage_instructions', e.target.value)}
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Conservation</label>
                <textarea
                  value={formData.conservation_instructions}
                  onChange={(e) => setField('conservation_instructions', e.target.value)}
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Conservation après ouverture</label>
                <textarea
                  value={formData.conservation_after_opening}
                  onChange={(e) => setField('conservation_after_opening', e.target.value)}
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
            </div>
          </section>

          {/* Origine et conformité */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Origine et conformité</h3>
            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>Pays d&apos;origine</label>
                <input
                  type="text"
                  value={formData.country_of_origin}
                  onChange={(e) => setField('country_of_origin', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label className={LABEL_CLS}>Type de durabilité</label>
                <div className="space-y-1.5 mt-1">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="durability_type"
                      checked={formData.durability_type === 'best_before'}
                      onChange={() => setField('durability_type', 'best_before')}
                      className="accent-[var(--color-primary)]"
                    />
                    DLUO — à consommer de préférence avant le
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="durability_type"
                      checked={formData.durability_type === 'use_by'}
                      onChange={() => setField('durability_type', 'use_by')}
                      className="accent-[var(--color-primary)]"
                    />
                    DLC — à consommer jusqu&apos;au
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Ingrédient mis en évidence (QUID)</label>
                  <input
                    type="text"
                    value={formData.quid_ingredient}
                    onChange={(e) => setField('quid_ingredient', e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Pourcentage %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={formData.quid_percentage}
                    onChange={(e) => setField('quid_percentage', e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_CLS}>Titre alcoométrique %</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.alcohol_pct}
                  onChange={(e) => setField('alcohol_pct', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </section>
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Valeurs nutritionnelles */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Valeurs nutritionnelles</h3>

            <div className="mb-4">
              <label className={LABEL_CLS}>Base</label>
              <div className="flex items-center gap-4 mt-1">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="nutrition_basis"
                    checked={formData.nutrition_basis === '100g'}
                    onChange={() => setField('nutrition_basis', '100g')}
                    className="accent-[var(--color-primary)]"
                  />
                  100 g
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="nutrition_basis"
                    checked={formData.nutrition_basis === '100ml'}
                    onChange={() => setField('nutrition_basis', '100ml')}
                    className="accent-[var(--color-primary)]"
                  />
                  100 ml
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {NUTRITION_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className={LABEL_CLS}>{label}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.nutrition[key] ?? ''}
                    onChange={(e) => updateNutrition(key, e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Quantité et emballage */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Quantité et emballage</h3>
            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>
                  Quantité nette à afficher (ex. &quot;1 L&quot;, laisser vide pour utiliser le poids)
                </label>
                <input
                  type="text"
                  value={formData.net_quantity_display}
                  onChange={(e) => setField('net_quantity_display', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Matériau d&apos;emballage</label>
                <input
                  type="text"
                  value={formData.packaging_material}
                  onChange={(e) => setField('packaging_material', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Note de tri sélectif</label>
                <textarea
                  value={formData.recycling_note}
                  onChange={(e) => setField('recycling_note', e.target.value)}
                  rows={3}
                  className={`${INPUT_CLS} resize-none`}
                />
              </div>
            </div>
          </section>

          {/* Fond d'étiquette */}
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className={SECTION_TITLE_CLS}>Fond d&apos;étiquette</h3>

            {isNew ? (
              <p className="text-xs text-gray-400">
                Enregistrez d&apos;abord le produit pour ajouter un fond d&apos;étiquette.
              </p>
            ) : (
              <>
                <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-gray-100 mb-4">
                  {formData.label_background_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={formData.label_background_image_url}
                      alt="Fond étiquette"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                      <IconPhoto size={32} className="text-gray-300" />
                      <span className="text-xs text-gray-400">Aucun fond</span>
                    </div>
                  )}
                </div>

                {formData.label_background_image_url && (
                  <button
                    onClick={() => setField('label_background_image_url', null)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-red-200 text-red-500 hover:bg-red-50 transition-colors mb-3"
                  >
                    <IconTrash size={14} />
                    Supprimer le fond
                  </button>
                )}

                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingLabelBg(true); }}
                  onDragLeave={() => setIsDraggingLabelBg(false)}
                  onDrop={handleLabelBgDrop}
                  onClick={() => labelBgFileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-4 text-center mb-4 transition-colors cursor-pointer ${
                    isDraggingLabelBg
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <IconUpload size={20} className="mx-auto mb-1 text-gray-400" />
                  <p className="text-xs text-gray-500">
                    {isUploadingLabelBg ? 'Envoi...' : 'Glisser une image ici'}
                  </p>
                  <span className="text-xs text-gray-400">ou cliquer pour parcourir</span>
                </div>
                <input
                  ref={labelBgFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLabelBgUpload(file);
                  }}
                />
              </>
            )}

            <div className="mt-1">
              <label className={LABEL_CLS}>Couleur de fond</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(formData.label_background_color) ? formData.label_background_color : '#ffffff'}
                  onChange={(e) => setField('label_background_color', e.target.value)}
                  className="h-10 w-14 rounded border border-gray-200 cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  value={formData.label_background_color}
                  onChange={(e) => setField('label_background_color', e.target.value)}
                  placeholder="#FFFFFF"
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <p className="text-xs text-gray-400 mt-3">
              Si non défini, utilise le fond de la catégorie ; si celui-ci n&apos;est
              pas défini non plus, utilise la couleur par défaut du modèle.
            </p>
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
