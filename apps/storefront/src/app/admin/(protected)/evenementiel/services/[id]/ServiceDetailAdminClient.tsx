'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconPhoto, IconTrash } from '@tabler/icons-react';
import Button from '../../../../_components/ui/Button';
import RentalCatalogAdmin from './RentalCatalogAdmin';
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
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  async function patchOffering(fields: Partial<ServiceOffering>) {
    const res = await fetch(`/api/admin/evenementiel/services/${offering.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const result = await res.json().catch(() => null);
      throw new Error(result?.error ?? 'Erreur lors de la mise à jour.');
    }
    setOffering((prev) => ({ ...prev, ...fields }));
  }

  async function toggleActive() {
    try {
      await patchOffering({ active: !offering.active });
    } catch {
      // Keep the current state if the request fails.
    }
  }

  async function toggleCtaType() {
    const next: ServiceCtaType = offering.cta_type === 'devis' ? 'reservation' : 'devis';
    try {
      await patchOffering({ cta_type: next });
    } catch {
      // Keep the current state if the request fails.
    }
  }

  async function saveDescription() {
    setSavingDescription(true);
    try {
      await patchOffering({ description: description.trim() || null });
    } finally {
      setSavingDescription(false);
    }
  }

  async function uploadCover(file: File | null) {
    if (!file) return;
    setCoverError(null);
    setUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'service-cover');

      const uploadRes = await fetch('/api/admin/evenementiel/upload-image', {
        method: 'POST',
        body: formData,
      });
      const uploadResult = await uploadRes.json();
      if (!uploadRes.ok) {
        throw new Error(uploadResult.error ?? 'Erreur lors du téléversement.');
      }

      await patchOffering({ cover_image_url: uploadResult.imageUrl as string });
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : 'Erreur lors du téléversement.');
    } finally {
      setUploadingCover(false);
    }
  }

  async function removeCover() {
    setCoverError(null);
    try {
      await patchOffering({ cover_image_url: null });
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : 'Erreur lors de la suppression.');
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
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">Photo de couverture</p>
            <p className="text-xs text-gray-400">Utilisée sur la page Événementiel et sur la page publique du service.</p>
          </div>
          {offering.cover_image_url && (
            <Button type="button" variant="ghost" size="sm" onClick={removeCover}>
              <IconTrash size={15} /> Retirer
            </Button>
          )}
        </div>

        {offering.cover_image_url ? (
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
            <div className="aspect-[16/7] w-full bg-cover bg-center" style={{ backgroundImage: `url(${offering.cover_image_url})` }} />
          </div>
        ) : (
          <div className="flex aspect-[16/7] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-400">
            <div className="text-center">
              <IconPhoto size={28} className="mx-auto mb-2" />
              <p className="text-xs">Aucune photo de couverture</p>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            {uploadingCover ? 'Téléversement…' : offering.cover_image_url ? 'Remplacer la photo' : 'Ajouter une photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={uploadingCover}
              onChange={(e) => {
                void uploadCover(e.target.files?.[0] ?? null);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <span className="text-xs text-gray-400">JPG, PNG ou WebP · image large recommandée</span>
        </div>
        {coverError && <p className="mt-2 text-xs text-red-500">{coverError}</p>}
      </section>

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
        <RentalCatalogAdmin serviceId={offering.id} initialItems={initialRentalItems} currency={currency} />
      )}
    </div>
  );
}
