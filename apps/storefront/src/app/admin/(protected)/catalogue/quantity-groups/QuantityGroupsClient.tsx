'use client';

import { useEffect, useState } from 'react';
import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import ConfirmActionModal from '../../../_components/ui/ConfirmActionModal';

interface GroupProduct { id: string; name: string }
interface Group {
  id: string;
  name: string;
  min_quantity: number;
  quantity_step: number;
  active: boolean;
  products: GroupProduct[];
}
interface ProductOption { id: string; name: string; active: boolean }

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

function validQuantitiesPreview(min: number, step: number): string {
  return Array.from({ length: 5 }, (_, i) => min + i * step).join(' · ');
}

export default function QuantityGroupsClient({ products }: { products: ProductOption[] }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);

  const [newName, setNewName] = useState('');
  const [newMin, setNewMin] = useState('12');
  const [newStep, setNewStep] = useState('6');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadGroups() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/catalogue/quantity-groups');
      const data = await res.json();
      if (res.ok) setGroups(data.groups ?? []);
      else setToast({ msg: data.error ?? 'Erreur de chargement.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadGroups(); }, []);

  async function createGroup() {
    if (!newName.trim()) { setToast({ msg: 'Nom requis.', type: 'error' }); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/catalogue/quantity-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, min_quantity: newMin, quantity_step: newStep }),
      });
      const data = await res.json();
      if (!res.ok) { setToast({ msg: data.error ?? 'Erreur.', type: 'error' }); return; }
      setNewName(''); setNewMin('12'); setNewStep('6');
      setToast({ msg: 'Groupe créé.', type: 'success' });
      await loadGroups();
    } finally {
      setCreating(false);
    }
  }

  async function patchGroup(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/admin/catalogue/quantity-groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { setToast({ msg: data.error ?? 'Erreur.', type: 'error' }); return false; }
    return true;
  }

  async function deleteGroup(group: Group) {
    const res = await fetch(`/api/admin/catalogue/quantity-groups/${group.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { setToast({ msg: data.error ?? 'Erreur.', type: 'error' }); return; }
    setToast({ msg: 'Groupe supprimé.', type: 'success' });
    setPendingDelete(null);
    await loadGroups();
  }

  async function addProduct(groupId: string, productId: string) {
    const res = await fetch(`/api/admin/catalogue/quantity-groups/${groupId}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId }),
    });
    const data = await res.json();
    if (!res.ok) { setToast({ msg: data.error ?? 'Erreur.', type: 'error' }); return; }
    await loadGroups();
  }

  async function removeProduct(groupId: string, productId: string) {
    const res = await fetch(`/api/admin/catalogue/quantity-groups/${groupId}/products?product_id=${productId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) { setToast({ msg: data.error ?? 'Erreur.', type: 'error' }); return; }
    await loadGroups();
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Nouveau groupe</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Nom</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Boissons" className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Quantité minimale</label>
            <input type="number" min={1} value={newMin} onChange={(e) => setNewMin(e.target.value)} className={INPUT_CLS} />
          </div>
          <div>
            <label className={LABEL_CLS}>Incrément</label>
            <input type="number" min={1} value={newStep} onChange={(e) => setNewStep(e.target.value)} className={INPUT_CLS} />
          </div>
        </div>
        <button
          onClick={createGroup}
          disabled={creating}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <IconPlus size={16} /> Créer le groupe
        </button>
      </section>

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-gray-50" />
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-400">Aucun groupe pour le moment.</p>
      ) : (
        groups.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            products={products}
            onPatch={(payload) => patchGroup(group.id, payload).then((ok) => { if (ok) loadGroups(); })}
            onDelete={() => setPendingDelete(group)}
            onAddProduct={(productId) => addProduct(group.id, productId)}
            onRemoveProduct={(productId) => removeProduct(group.id, productId)}
          />
        ))
      )}

      <ConfirmActionModal
        open={pendingDelete !== null}
        title={`Supprimer « ${pendingDelete?.name ?? ''} » ?`}
        description="Le groupe et son association aux produits seront supprimés. La règle de quantité combinée cessera immédiatement de s'appliquer."
        destructive
        confirmLabel="Supprimer"
        onConfirm={() => pendingDelete && deleteGroup(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function GroupCard({
  group, products, onPatch, onDelete, onAddProduct, onRemoveProduct,
}: {
  group: Group;
  products: ProductOption[];
  onPatch: (payload: Record<string, unknown>) => void;
  onDelete: () => void;
  onAddProduct: (productId: string) => void;
  onRemoveProduct: (productId: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const [minQuantity, setMinQuantity] = useState(String(group.min_quantity));
  const [quantityStep, setQuantityStep] = useState(String(group.quantity_step));
  const [search, setSearch] = useState('');

  const dirty = name !== group.name || minQuantity !== String(group.min_quantity) || quantityStep !== String(group.quantity_step);
  const memberIds = new Set(group.products.map((p) => p.id));
  const candidates = search.trim().length >= 2
    ? products.filter((p) => !memberIds.has(p.id) && p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : [];

  return (
    <section className={`bg-white rounded-xl border p-5 ${group.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <label className={LABEL_CLS}>Nom</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLS} />
        </div>
        <div className="w-32">
          <label className={LABEL_CLS}>Minimum</label>
          <input type="number" min={1} value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} className={INPUT_CLS} />
        </div>
        <div className="w-32">
          <label className={LABEL_CLS}>Incrément</label>
          <input type="number" min={1} value={quantityStep} onChange={(e) => setQuantityStep(e.target.value)} className={INPUT_CLS} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onPatch({ active: !group.active })}
            className={`relative w-10 h-6 rounded-full transition-colors ${group.active ? 'bg-[var(--color-primary)]' : 'bg-gray-200'}`}
            aria-label="Activer le groupe"
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${group.active ? 'right-1' : 'left-1'}`} />
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => onPatch({ name, min_quantity: minQuantity, quantity_step: quantityStep })}
              className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-xs font-semibold text-white"
            >
              Enregistrer
            </button>
          )}
          <button type="button" onClick={onDelete} aria-label="Supprimer le groupe" className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:text-red-600 hover:border-red-200">
            <IconTrash size={16} />
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Quantités valides : {validQuantitiesPreview(Number(minQuantity) || 1, Number(quantityStep) || 1)}...
      </p>

      <div className="mt-4">
        <label className={LABEL_CLS}>Produits membres ({group.products.length})</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {group.products.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 pl-3 pr-1.5 py-1 text-xs font-medium text-gray-700">
              {p.name}
              <button type="button" onClick={() => onRemoveProduct(p.id)} aria-label={`Retirer ${p.name}`} className="rounded-full p-0.5 hover:bg-gray-200">
                <IconX size={12} />
              </button>
            </span>
          ))}
          {group.products.length === 0 && <span className="text-xs text-gray-400">Aucun produit associé.</span>}
        </div>
        <div className="relative max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un produit à ajouter…"
            className={INPUT_CLS}
          />
          {candidates.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
              {candidates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onAddProduct(p.id); setSearch(''); }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span>{p.name}</span>
                  {!p.active && <span className="text-xs text-gray-400">inactif</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
