'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CatalogCategoryOption, CatalogScope } from '@lepefy/types';

const blank = { id: '', name: '', slug: '', catalog_scope: 'shop' as CatalogScope };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CatalogCategoryOption[]>([]);
  const [form, setForm] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/catalogue/categories', { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Chargement impossible.');
        setCategories(data.categories);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Chargement impossible.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/catalogue/categories', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Enregistrement impossible.');
      const category = data.category as CatalogCategoryOption;
      setCategories(current => form.id ? current.map(item => item.id === form.id ? category : item) : [...current, category]);
      setForm(blank);
      setMessage('Catégorie enregistrée.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally { setSaving(false); }
  }

  return <div className="mx-auto max-w-4xl space-y-5 pb-24">
    <Link href="/admin/catalogue" className="inline-flex min-h-11 items-center text-sm text-gray-600">← Catalogue</Link>
    <header><h1 className="text-2xl font-bold">Catégories</h1><p className="mt-2 text-sm text-gray-600">Organisez vos produits dans le Catalogue ou la boutique Goodies.</p></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">{message}</p>}
    <form onSubmit={save} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">{form.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Nom
          <input required maxLength={120} value={form.name} onChange={event => {
            const name = event.target.value;
            setForm(current => ({ ...current, name, ...(!current.id ? { slug: name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') } : {}) }));
          }} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" />
        </label>
        <label className="text-sm font-medium">Adresse de la catégorie
          <input required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} onChange={event => setForm(current => ({ ...current, slug: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3" />
        </label>
      </div>
      <label className="block text-sm font-medium">Destination
        <select value={form.catalog_scope} onChange={event => setForm(current => ({ ...current, catalog_scope: event.target.value as CatalogScope }))} className="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3">
          <option value="shop">Catalogue</option><option value="gadgets">Goodies</option>
        </select>
      </label>
      <p className="text-xs text-gray-500">Tous les produits de cette catégorie apparaissent dans la destination choisie.</p>
      <div className="flex gap-3">
        <button disabled={saving || loading} className="min-h-11 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        {form.id && <button type="button" disabled={saving} onClick={() => setForm(blank)} className="min-h-11 rounded-xl border px-4 text-sm">Annuler</button>}
      </div>
    </form>
    <section aria-label="Catégories existantes" className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
      {loading ? <p className="p-5 text-sm text-gray-500">Chargement…</p> : categories.length === 0 ? <p className="p-5 text-sm text-gray-500">Aucune catégorie pour le moment.</p> : categories.map(category => <div key={category.id} className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{category.name}</p><p className="text-xs text-gray-500">{category.catalog_scope === 'gadgets' ? 'Goodies' : 'Catalogue'}</p></div>
        <button type="button" disabled={saving} onClick={() => { setForm(category); setMessage(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={`Modifier ${category.name}`} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm">Modifier</button>
      </div>)}
    </section>
  </div>;
}
