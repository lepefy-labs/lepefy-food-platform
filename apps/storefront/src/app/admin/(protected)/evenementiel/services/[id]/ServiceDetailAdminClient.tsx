'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconPlus, IconTrash } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import type { ServiceOffering, RentalItem, ServiceCtaType } from '@lepefy/types';

interface Props {
  offering: ServiceOffering;
  initialRentalItems: RentalItem[];
  currency: string;
}

export default function ServiceDetailAdminClient({ offering: initialOffering, initialRentalItems, currency }: Props) {
  const [offering, setOffering] = useState(initialOffering);
  const [description, setDescription] = useState(offering.description ?? '');
  const [savingDescription, setSavingDescription] = useState(false);

  const [rentalItems, setRentalItems] = useState(initialRentalItems);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemStock, setItemStock] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  async function toggleActive() {
    const next = !offering.active;
    const res = await fetch(`/api/admin/evenementiel/services/${offering.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: next }),
    });
    if (res.ok) setOffering((prev) => ({ ...prev, active: next }));
  }

  async function toggleCtaType() {
    const next: ServiceCtaType = offering.cta_type === 'devis' ? 'reservation' : 'devis';
    const res = await fetch(`/api/admin/evenementiel/services/${offering.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cta_type: next }),
    });
    if (res.ok) setOffering((prev) => ({ ...prev, cta_type: next }));
  }

  async function saveDescription() {
    setSavingDescription(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/services/${offering.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() || null }),
      });
      if (res.ok) setOffering((prev) => ({ ...prev, description: description.trim() || null }));
    } finally {
      setSavingDescription(false);
    }
  }

  async function addRentalItem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const price = Number(itemPrice);
    const stock = Number(itemStock || '0');
    if (!itemName.trim() || !Number.isFinite(price) || price < 0) {
      setError('Nom et prix valides requis.');
      return;
    }
    setAddingItem(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/services/${offering.id}/rental-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: itemName.trim(), price_per_unit: price, stock_quantity: stock }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Erreur.');
        return;
      }
      setRentalItems((prev) => [...prev, result]);
      setItemName(''); setItemPrice(''); setItemStock('');
    } finally {
      setAddingItem(false);
    }
  }

  async function removeRentalItem(id: string) {
    const res = await fetch(`/api/admin/evenementiel/rental-items/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const result = await res.json();
      if (result.deactivated) {
        setRentalItems((prev) => prev.map((i) => (i.id === id ? { ...i, active: false } : i)));
      } else {
        setRentalItems((prev) => prev.filter((i) => i.id !== id));
      }
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/evenementiel/services" className="text-sm text-gray-500 flex items-center gap-1.5 hover:text-gray-700">
        <IconArrowLeft size={14} /> Retour aux services
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{offering.title}</h1>
          <p className="text-sm text-gray-500">/evenementiel/services/{offering.slug}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleCtaType}
            className="text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-600"
          >
            Mode : {offering.cta_type === 'devis' ? 'Devis' : 'Réservation'}
          </button>
          <button
            type="button"
            onClick={toggleActive}
            className={`text-xs font-semibold px-3 py-2 rounded-lg border ${offering.active ? 'border-green-200 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'}`}
          >
            {offering.active ? 'Actif' : 'Inactif'}
          </button>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-2">Description</p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          rows={4}
          disabled={savingDescription}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
      </section>

      {offering.cta_type === 'reservation' && (
        <section className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">Catalogue matériel</p>
          <div className="space-y-2 mb-3">
            {rentalItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${item.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{item.name}</p>
                  <p className="text-xs text-gray-500">
                    {formatPrice(item.price_per_unit, currency)} · stock {item.stock_quantity}
                  </p>
                </div>
                <button type="button" onClick={() => removeRentalItem(item.id)} className="text-gray-400 hover:text-red-500">
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
            {rentalItems.length === 0 && <p className="text-xs text-gray-400">Aucun article — ajoutez-en un ci-dessous.</p>}
          </div>
          <form onSubmit={addRentalItem} className="flex items-center gap-2">
            <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Nom de l'article" className={`${inputClass} flex-1`} />
            <input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} placeholder="Prix" inputMode="decimal" className={`${inputClass} w-20`} />
            <input value={itemStock} onChange={(e) => setItemStock(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Stock" inputMode="numeric" className={`${inputClass} w-20`} />
            <button
              type="submit"
              disabled={addingItem}
              className="p-2.5 rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <IconPlus size={16} />
            </button>
          </form>
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
        </section>
      )}
    </div>
  );
}
