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

  // ── Étiquette tab state ──────────────────────────────────────────────────
  const [glutenFreeCertified, setGlutenFreeCertified] = useState(product.gluten_free_certified ?? false);
  const [nutritionBasis, setNutritionBasis]           = useState<'100g' | '100ml'>(product.nutrition_basis ?? '100g');
  const [nutrition, setNutrition]                     = useState<NutritionInfo>(product.nutrition ?? {});
  const [durabilityType, setDurabilityType]           = useState<DurabilityType | ''>(product.durability_type ?? '');
  const [labelBgUrl, setLabelBgUrl]                   = useState(product.label_background_image_url);
  const [labelBgColor, setLabelBgColor]                = useState(product.label_background_color ?? '');
  const [isDraggingLabelBg, setIsDraggingLabelBg]     = useState(false);
  const [isUploadingLabelBg, setIsUploadingLabelBg]   = useState(false);

  const fileInputRef        = useRef<HTMLInputElement>(null);
  const nameRef              = useRef<HTMLInputElement>(null);
  const descriptionRef       = useRef<HTMLTextAreaElement>(null);
  const priceRef             = useRef<HTMLInputElement>(null);
  const weightRef            = useRef<HTMLInputElement>(null);
  const stockRef             = useRef<HTMLInputElement>(null);
  const storageTypeRef       = useRef<HTMLSelectElement>(null);
  const categoryRef          = useRef<HTMLSelectElement>(null);
  const warehouseRef         = useRef<HTMLInputElement>(null);

  const producerRef                    = useRef<HTMLSelectElement>(null);
  const importerRef                    = useRef<HTMLSelectElement>(null);
  const ingredientsRef                 = useRef<HTMLTextAreaElement>(null);
  const allergensRef                   = useRef<HTMLTextAreaElement>(null);
  const usageRef                       = useRef<HTMLTextAreaElement>(null);
  const conservationRef                = useRef<HTMLTextAreaElement>(null);
  const conservationAfterOpeningRef    = useRef<HTMLTextAreaElement>(null);
  const countryOfOriginRef             = useRef<HTMLInputElement>(null);
  const quidIngredientRef              = useRef<HTMLInputElement>(null);
  const quidPercentageRef              = useRef<HTMLInputElement>(null);
  const alcoholPctRef                  = useRef<HTMLInputElement>(null);
  const netQuantityDisplayRef          = useRef<HTMLInputElement>(null);
  const packagingMaterialRef           = useRef<HTMLInputElement>(null);
  const recyclingNoteRef               = useRef<HTMLTextAreaElement>(null);
  const labelBgFileInputRef            = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
  }

  function updateNutrition(key: keyof NutritionInfo, raw: string) {
    setNutrition((prev) => {
      const next = { ...prev };
      if (raw === '') {
        delete next[key];
      } else {
        const num = parseFloat(raw);
        if (Number.isNaN(num)) delete next[key];
        else next[key] = num;
      }
      return next;
    });
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

        producer_id:                 producerRef.current?.value || null,
        importer_id:                 importerRef.current?.value || null,
        ingredients_text:            ingredientsRef.current?.value ?? '',
        allergens_text:              allergensRef.current?.value ?? '',
        gluten_free_certified:       glutenFreeCertified,
        usage_instructions:          usageRef.current?.value ?? '',
        conservation_instructions:   conservationRef.current?.value ?? '',
        conservation_after_opening:  conservationAfterOpeningRef.current?.value ?? '',
        country_of_origin:           countryOfOriginRef.current?.value ?? '',
        durability_type:             durabilityType || null,
        quid_ingredient:              quidIngredientRef.current?.value ?? '',
        quid_percentage:              quidPercentageRef.current?.value ?? '',
        alcohol_pct:                  alcoholPctRef.current?.value ?? '',
        net_quantity_display:         netQuantityDisplayRef.current?.value ?? '',
        packaging_material:           packagingMaterialRef.current?.value ?? '',
        recycling_note:               recyclingNoteRef.current?.value ?? '',
        nutrition_basis:              nutritionBasis,
        nutrition:                    cleanNutrition(nutrition),
        label_background_image_url:   labelBgUrl,
        label_background_color:       labelBgColor || null,
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
      const currentCategoryId = categoryRef.current?.value ?? product.category_id;
      const currentCategory   = categories.find(c => c.id === currentCategoryId);

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
      setImageUrl(newUrl);
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

  async function handleDeleteImage() {
    setImageUrl(null);
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
    setLabelBgUrl(localUrl);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('target', 'product-background');
      formData.append('entityId', product.id);

      const res = await fetch('/api/admin/upload-label-asset', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json() as { assetUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Échec du téléversement');

      setLabelBgUrl(data.assetUrl ?? null);
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
      {activeTab === 'generale' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Card: Informations */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className={SECTION_TITLE_CLS}>Informations</h2>

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
              <h2 className={SECTION_TITLE_CLS}>
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
              <h2 className={SECTION_TITLE_CLS}>Médias</h2>

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
              {imageUrl && (
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
              <h2 className={SECTION_TITLE_CLS}>Stock</h2>
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
      )}

      {/* ── Onglet Étiquette ────────────────────────────────────────────────── */}
      {activeTab === 'etichetta' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Producteur et importateur */}
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className={SECTION_TITLE_CLS}>Producteur et importateur</h3>
              <div className="space-y-4">
                <div>
                  <label className={LABEL_CLS}>Producteur</label>
                  <select
                    ref={producerRef}
                    defaultValue={product.producer_id ?? ''}
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
                    ref={importerRef}
                    defaultValue={product.importer_id ?? ''}
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
                    ref={ingredientsRef}
                    defaultValue={product.ingredients_text ?? ''}
                    rows={4}
                    className={`${INPUT_CLS} resize-none`}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Allergènes</label>
                  <textarea
                    ref={allergensRef}
                    defaultValue={product.allergens_text ?? ''}
                    rows={3}
                    className={`${INPUT_CLS} resize-none`}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={glutenFreeCertified}
                      onChange={(e) => setGlutenFreeCertified(e.target.checked)}
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
                    ref={usageRef}
                    defaultValue={product.usage_instructions ?? ''}
                    rows={3}
                    className={`${INPUT_CLS} resize-none`}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Conservation</label>
                  <textarea
                    ref={conservationRef}
                    defaultValue={product.conservation_instructions ?? ''}
                    rows={3}
                    className={`${INPUT_CLS} resize-none`}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Conservation après ouverture</label>
                  <textarea
                    ref={conservationAfterOpeningRef}
                    defaultValue={product.conservation_after_opening ?? ''}
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
                    ref={countryOfOriginRef}
                    type="text"
                    defaultValue={product.country_of_origin ?? ''}
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
                        checked={durabilityType === 'best_before'}
                        onChange={() => setDurabilityType('best_before')}
                        className="accent-[var(--color-primary)]"
                      />
                      DLUO — à consommer de préférence avant le
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="durability_type"
                        checked={durabilityType === 'use_by'}
                        onChange={() => setDurabilityType('use_by')}
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
                      ref={quidIngredientRef}
                      type="text"
                      defaultValue={product.quid_ingredient ?? ''}
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>Pourcentage %</label>
                    <input
                      ref={quidPercentageRef}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      defaultValue={product.quid_percentage ?? ''}
                      className={INPUT_CLS}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLS}>Titre alcoométrique %</label>
                  <input
                    ref={alcoholPctRef}
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={product.alcohol_pct ?? ''}
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
                      checked={nutritionBasis === '100g'}
                      onChange={() => setNutritionBasis('100g')}
                      className="accent-[var(--color-primary)]"
                    />
                    100 g
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="nutrition_basis"
                      checked={nutritionBasis === '100ml'}
                      onChange={() => setNutritionBasis('100ml')}
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
                      value={nutrition[key] ?? ''}
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
                    ref={netQuantityDisplayRef}
                    type="text"
                    defaultValue={product.net_quantity_display ?? ''}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Matériau d&apos;emballage</label>
                  <input
                    ref={packagingMaterialRef}
                    type="text"
                    defaultValue={product.packaging_material ?? ''}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Note de tri sélectif</label>
                  <textarea
                    ref={recyclingNoteRef}
                    defaultValue={product.recycling_note ?? ''}
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
                    {labelBgUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={labelBgUrl}
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

                  {labelBgUrl && (
                    <button
                      onClick={() => setLabelBgUrl(null)}
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
                    value={/^#[0-9a-fA-F]{6}$/.test(labelBgColor) ? labelBgColor : '#ffffff'}
                    onChange={(e) => setLabelBgColor(e.target.value)}
                    className="h-10 w-14 rounded border border-gray-200 cursor-pointer shrink-0"
                  />
                  <input
                    type="text"
                    value={labelBgColor}
                    onChange={(e) => setLabelBgColor(e.target.value)}
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
      )}

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
