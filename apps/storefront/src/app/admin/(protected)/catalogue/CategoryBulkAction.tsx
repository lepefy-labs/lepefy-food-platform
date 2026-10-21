'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '../../_components/ui/Button';
import Dialog from '../../_components/ui/Dialog';
import { Select } from '../../_components/ui/Form';
import { useAdminToast } from '../../_components/ui/Toaster';

export interface BulkCategoryOption { id: string; name: string; catalog_scope: string | null }

/** « Changer de catégorie » for the selected rows: one PATCH per product (same validation, audit and cache invalidation as the editor). */
export default function CategoryBulkAction({ ids, clear, categories }: { ids: string[]; clear: () => void; categories: BulkCategoryOption[] }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState('');
  const [pending, setPending] = useState(false);
  const toast = useAdminToast();
  const router = useRouter();
  const noun = `${ids.length} produit${ids.length > 1 ? 's' : ''}`;

  async function apply() {
    if (!chosen) return;
    setPending(true);
    const categoryId = chosen === 'none' ? null : chosen;
    const results = await Promise.allSettled(ids.map(async (id) => {
      const response = await fetch(`/api/admin/catalogue/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category_id: categoryId }) });
      if (!response.ok) throw new Error('Mise à jour échouée');
    }));
    setPending(false);
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      toast.error(`${failed} produit${failed > 1 ? 's' : ''} sur ${ids.length} n’ont pas pu changer de catégorie.`);
    } else {
      const name = categoryId ? categories.find((category) => category.id === categoryId)?.name : null;
      toast.success(name ? `${noun} dans « ${name} »` : `${noun} sans catégorie`);
      setOpen(false);
      clear();
    }
    router.refresh();
  }

  return <>
    <Button variant="secondary" size="sm" onClick={() => { setChosen(''); setOpen(true); }}>Changer de catégorie</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Changer de catégorie" size="sm"
      description={`${noun} sélectionné${ids.length > 1 ? 's' : ''}. La boutique est mise à jour immédiatement.`}
      dismissible={!pending}
      footer={<>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
        <Button onClick={() => void apply()} disabled={!chosen || pending}>{pending ? 'Enregistrement…' : 'Appliquer'}</Button>
      </>}>
      <label htmlFor="bulk-category" className="block text-sm font-medium">Nouvelle catégorie</label>
      <Select id="bulk-category" value={chosen} onChange={(event) => setChosen(event.target.value)} disabled={pending} className="mt-2 w-full">
        <option value="">Choisir une catégorie</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name} — {category.catalog_scope === 'gadgets' ? 'Goodies' : 'Catalogue'}</option>
        ))}
        <option value="none">Sans catégorie</option>
      </Select>
    </Dialog>
  </>;
}
