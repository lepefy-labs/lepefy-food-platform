'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { IconPencil, IconPhoto, IconPlus, IconTrash } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import Button from '../../../../_components/ui/Button';
import type { RentalItem } from '@lepefy/types';

interface Props {
  serviceId: string;
  initialItems: RentalItem[];
  currency: string;
}

export default function RentalCatalogAdmin({ serviceId, initialItems, currency }: Props) {
  const [items, setItems] = useState(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = uploading || saving || removingId !== null;
  const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] sm:text-sm';

  function resetForm() {
    setEditingId(null);
    setName(''); setCategory(''); setPrice(''); setStock('');
    setImageUrl(null); setActive(true); setError(null);
  }

  function editItem(item: RentalItem) {
    setEditingId(item.id);
    setName(item.name); setCategory(item.category ?? '');
    setPrice(String(item.price_per_unit)); setStock(String(item.stock_quantity));
    setImageUrl(item.image_url); setActive(item.active); setError(null);
  }

  async function uploadPhoto(file: File | null) {
    if (!file || busy) return;
    setError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      setError('Choisissez une image JPG, PNG ou WebP de 4 Mo maximum.');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'rental-item');
      const res = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok || typeof result.imageUrl !== 'string') {
        throw new Error(result.error ?? 'Erreur lors du téléversement.');
      }
      setImageUrl(result.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setUploading(false);
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const unitPrice = Number(price);
    const quantity = Number(stock);
    if (!name.trim() || !price.trim() || !stock.trim() || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isInteger(quantity) || quantity < 0) {
      setError('Nom, prix et quantité disponible valides requis.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editingId
        ? '/api/admin/evenementiel/rental-items/' + editingId
        : '/api/admin/evenementiel/services/' + serviceId + '/rental-items', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), category: category.trim() || null,
          price_per_unit: unitPrice, stock_quantity: quantity,
          image_url: imageUrl, active,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Erreur lors de l’enregistrement.');
      setItems((previous) => editingId
        ? previous.map((item) => item.id === editingId ? result : item)
        : [...previous, result]);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    if (busy) return;
    setError(null); setRemovingId(id);
    try {
      const res = await fetch('/api/admin/evenementiel/rental-items/' + id, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Erreur lors de la suppression.');
      setItems((previous) => result.deactivated
        ? previous.map((item) => item.id === id ? { ...item, active: false } : item)
        : previous.filter((item) => item.id !== id));
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Catalogue matériel</h2>
        <span className="text-xs text-gray-500">{items.length} article{items.length > 1 ? 's' : ''}</span>
      </div>
      <div className="mb-5 space-y-3">
        {items.map((item) => (
          <article key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 p-3">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-white">
              {item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image_url} alt={item.name} className="size-full object-contain p-1" />
              ) : <IconPhoto size={22} className="text-gray-300" />}
            </div>
            <div className="min-w-0 flex-1 basis-40">
              <p className={'break-words text-sm font-medium ' + (item.active ? 'text-gray-900' : 'text-gray-400')}>{item.name}</p>
              {item.category && <p className="text-xs text-gray-500">{item.category}</p>}
              <p className="mt-1 text-xs text-gray-500">{formatPrice(item.price_per_unit, currency)} · {item.stock_quantity} disponible{item.stock_quantity > 1 ? 's' : ''}{!item.active && ' · Inactif'}</p>
            </div>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => editItem(item)} aria-label={'Modifier ' + item.name}>
                <IconPencil size={16} /> Modifier
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => removeItem(item.id)} aria-label={'Supprimer ' + item.name}>
                <IconTrash size={16} />
              </Button>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="text-sm text-gray-400">Aucun article — ajoutez le premier ci-dessous.</p>}
      </div>

      <form onSubmit={saveItem} className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">{editingId ? 'Modifier l’article' : 'Ajouter un article'}</h3>
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-gray-600 sm:col-span-2">Nom de l’article *
              <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </label>
            <label className="text-sm text-gray-600 sm:col-span-2">Catégorie
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex. Chauffe-plats, Barbecue" className={inputClass} />
            </label>
            <label className="text-sm text-gray-600">Prix par unité ({currency}) *
              <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" required className={inputClass} />
            </label>
            <label className="text-sm text-gray-600">Quantité disponible *
              <input value={stock} onChange={(e) => setStock(e.target.value)} type="number" min="0" step="1" inputMode="numeric" required className={inputClass} />
            </label>
          </div>
          <div>
            <label className="block text-sm text-gray-600">Photo de l’article
              <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-gray-200 file:bg-white file:px-3 file:text-gray-700" onChange={(e) => {
                const file = e.currentTarget.files?.[0] ?? null;
                e.currentTarget.value = '';
                void uploadPhoto(file);
              }} />
            </label>
            <p className="mt-1 text-xs text-gray-500">{uploading ? 'Téléversement…' : 'JPG, PNG ou WebP · 4 Mo maximum'}</p>
            {imageUrl && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Aperçu de la photo de l’article" className="size-28 rounded-lg border border-gray-200 bg-white object-contain p-2" />
                <button type="button" onClick={() => setImageUrl(null)} className="min-h-11 px-3 text-sm text-gray-600">Retirer la photo</button>
              </div>
            )}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4" />
            Visible dans le catalogue public
          </label>
          <p className="text-xs text-gray-500">Une quantité de 0 bloque la réservation de cet article.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saving} disabled={busy}>
              <IconPlus size={16} /> {saving ? 'Enregistrement…' : editingId ? 'Enregistrer l’article' : 'Ajouter l’article'}
            </Button>
            {editingId && <Button type="button" variant="ghost" onClick={resetForm}>Annuler</Button>}
          </div>
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </form>
    </section>
  );
}
