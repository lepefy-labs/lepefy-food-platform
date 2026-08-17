'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconPlus, IconChefHat, IconTools } from '@tabler/icons-react';
import { slugify } from '@/lib/utils/format';
import Button from '../../../_components/ui/Button';
import type { ServiceOffering, ServiceOfferingType, ServiceCtaType } from '@lepefy/types';

const TYPE_OPTIONS: { value: ServiceOfferingType; label: string }[] = [
  { value: 'traiteur', label: 'Traiteur' },
  { value: 'location_materiel', label: 'Location matériel' },
  { value: 'autre', label: 'Autre' },
];

export default function ServicesListClient({ initialServices }: { initialServices: ServiceOffering[] }) {
  const [services, setServices] = useState(initialServices);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ServiceOfferingType>('traiteur');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  // Un service Traiteur ouvre un formulaire de devis, un service Location
  // matériel ouvre un catalogue payant — mapping fixe, modifiable ensuite
  // dans le détail du service si besoin.
  const ctaType: ServiceCtaType = type === 'location_materiel' ? 'reservation' : 'devis';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Titre requis.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/evenementiel/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), slug: slugify(title), type, cta_type: ctaType }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Erreur lors de la création.');
        return;
      }
      setServices((prev) => [...prev, result]);
      setShowForm(false);
      setTitle('');
    } catch {
      setError('Erreur réseau.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button type="button" onClick={() => setShowForm((v) => !v)}>
        <IconPlus size={16} /> Nouveau service
      </Button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre du service" className={inputClass} />
          <select value={type} onChange={(e) => setType(e.target.value as ServiceOfferingType)} className={inputClass}>
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-xs text-gray-400">
            {ctaType === 'devis' ? 'Ce service ouvrira un formulaire de demande de devis.' : 'Ce service ouvrira un catalogue de matériel à réserver et payer en ligne.'}
          </p>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? 'Création…' : 'Créer'}
          </Button>
        </form>
      )}

      {services.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
          Aucun service pour le moment.
        </p>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {services.map((service) => (
            <Link
              key={service.id}
              href={`/admin/evenementiel/services/${service.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0 flex items-center gap-3">
                {service.type === 'traiteur' ? <IconChefHat size={16} className="text-gray-400 shrink-0" /> : <IconTools size={16} className="text-gray-400 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{service.title}</p>
                  <p className="text-xs text-gray-500">{service.cta_type === 'devis' ? 'Demande de devis' : 'Réservation en ligne'}</p>
                </div>
              </div>
              <span className={`text-2xs font-semibold px-2 py-1 rounded-full shrink-0 ${service.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {service.active ? 'Actif' : 'Inactif'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
