'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { IconCalendarEvent, IconPlus, IconSearch, IconTrash, IconUpload } from '@tabler/icons-react';
import { formatDate, slugify } from '@/lib/utils/format';
import Button from '../../../_components/ui/Button';
import type { EventRow, EventStatus } from '@lepefy/types';

interface DraftTicketType { label: string; description: string; price: string; }
type EventFilter = 'upcoming' | 'drafts' | 'history' | 'all';

const STATUS_LABELS: Record<EventStatus, string> = { draft: 'Brouillon', published: 'Publié', closed: 'Clôturé', cancelled: 'Annulé' };
const STATUS_COLORS: Record<EventStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300',
  closed: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
};

export default function EventsListClient({ initialEvents }: { initialEvents: EventRow[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [filter, setFilter] = useState<EventFilter>('upcoming');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [ticketTypes, setTicketTypes] = useState<DraftTicketType[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputClass = 'w-full min-h-11 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';
  const flexInputClass = 'min-h-11 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  const visibleEvents = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLocaleLowerCase('fr');
    return events
      .filter((event) => {
        const start = new Date(event.date_start).getTime();
        if (filter === 'upcoming') return start >= now && event.status !== 'cancelled' && event.status !== 'closed';
        if (filter === 'drafts') return event.status === 'draft';
        if (filter === 'history') return start < now || event.status === 'closed' || event.status === 'cancelled';
        return true;
      })
      .filter((event) => !q || `${event.title} ${event.location ?? ''}`.toLocaleLowerCase('fr').includes(q))
      .sort((a, b) => {
        const aTime = new Date(a.date_start).getTime();
        const bTime = new Date(b.date_start).getTime();
        return filter === 'history' ? bTime - aTime : aTime - bTime;
      });
  }, [events, filter, search]);

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setUploadingBanner(true);
    try {
      const formData = new FormData();
      formData.append('file', file); formData.append('kind', 'event-banner');
      const res = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) { setError(result.error ?? 'Erreur lors du téléversement de la bannière.'); return; }
      setBannerImageUrl(result.imageUrl);
    } finally {
      setUploadingBanner(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function addTicketTypeRow() { setTicketTypes((prev) => [...prev, { label: '', description: '', price: '' }]); }
  function updateTicketTypeRow(index: number, field: keyof DraftTicketType, value: string) { setTicketTypes((prev) => prev.map((t, i) => i === index ? { ...t, [field]: value } : t)); }
  function removeTicketTypeRow(index: number) { setTicketTypes((prev) => prev.filter((_, i) => i !== index)); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const capacityNum = Number(capacity);
    if (!title.trim() || !dateStart || !Number.isInteger(capacityNum) || capacityNum < 0) { setError('Titre, date et capacité valides requis.'); return; }
    const ticketTypesPayload: { label: string; description: string | null; price: number }[] = [];
    for (const t of ticketTypes) {
      const price = Number(t.price);
      if (!t.label.trim() || !Number.isFinite(price) || price < 0) { setError('Chaque formule doit avoir un libellé et un prix valides.'); return; }
      ticketTypesPayload.push({ label: t.label.trim(), description: t.description.trim() || null, price });
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/evenementiel/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), slug: slugify(title), date_start: new Date(dateStart).toISOString(), location: location.trim() || null, capacity_total: capacityNum, status: 'draft', banner_image_url: bannerImageUrl, ticket_types: ticketTypesPayload }),
      });
      const result = await res.json();
      if (!res.ok) { setError(result.error ?? 'Erreur lors de la création.'); return; }
      setEvents((prev) => [result, ...prev]); setShowForm(false); setFilter('drafts');
      setTitle(''); setDateStart(''); setLocation(''); setCapacity(''); setBannerImageUrl(null); setTicketTypes([]);
    } catch { setError('Erreur réseau.'); } finally { setIsSubmitting(false); }
  }

  const filters: { value: EventFilter; label: string }[] = [
    { value: 'upcoming', label: 'À venir' }, { value: 'drafts', label: 'Brouillons' }, { value: 'history', label: 'Historique' }, { value: 'all', label: 'Tous' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" onClick={() => setShowForm((v) => !v)}><IconPlus size={16} /> Nouvel événement</Button>
        <label className="relative w-full sm:max-w-xs">
          <span className="sr-only">Rechercher un événement</span><IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className={`${inputClass} pl-9`} />
        </label>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900" role="tablist" aria-label="Filtrer les événements">
        {filters.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} onClick={() => setFilter(item.value)} className={`min-h-11 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${filter === item.value ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5'}`}>{item.label}</button>)}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre de l'événement" className={inputClass} />
          <div className="grid gap-3 sm:grid-cols-2"><input value={dateStart} onChange={(e) => setDateStart(e.target.value)} type="datetime-local" className={inputClass} /><input value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Capacité totale" className={inputClass} /></div>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lieu (optionnel)" className={inputClass} />
          <div><p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">Bannière</p>{bannerImageUrl && <img src={bannerImageUrl} alt="Aperçu de la bannière" className="mb-2 max-h-40 w-full rounded-lg object-cover" />}
            <label className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-700"><IconUpload size={14} /> {uploadingBanner ? 'Téléversement…' : bannerImageUrl ? 'Changer l’image' : 'Ajouter une bannière'}<input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} disabled={uploadingBanner} /></label>
          </div>
          <div><div className="mb-1.5 flex items-center justify-between"><p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Formules</p><Button type="button" variant="ghost" size="sm" onClick={addTicketTypeRow}><IconPlus size={14} /> Ajouter une formule</Button></div>
            {ticketTypes.length === 0 && <p className="text-xs text-gray-400">Aucune formule — un événement publié doit avoir au moins une formule.</p>}
            <div className="space-y-2">{ticketTypes.map((t, i) => <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-gray-100 p-2 dark:border-gray-800"><div className="flex items-start gap-2"><input value={t.label} onChange={(e) => updateTicketTypeRow(i, 'label', e.target.value)} placeholder="Nom de la formule" className={`${flexInputClass} min-w-0 flex-1`} /><input value={t.price} onChange={(e) => updateTicketTypeRow(i, 'price', e.target.value)} placeholder="Prix €" inputMode="decimal" className={`${flexInputClass} w-24 shrink-0`} /><Button type="button" variant="ghost" size="sm" onClick={() => removeTicketTypeRow(i)} className="shrink-0" title="Supprimer la formule"><IconTrash size={16} /></Button></div><input value={t.description} onChange={(e) => updateTicketTypeRow(i, 'description', e.target.value)} placeholder="Description (optionnel)" className={inputClass} /></div>)}</div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}<Button type="submit" loading={isSubmitting}>{isSubmitting ? 'Création…' : 'Créer'}</Button>
        </form>
      )}

      {visibleEvents.length === 0 ? <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">Aucun événement dans cette vue.</div> : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"><div className="divide-y divide-gray-100 dark:divide-gray-800">{visibleEvents.map((event) => <Link key={event.id} href={`/admin/evenementiel/evenements/${event.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)] dark:hover:bg-white/5"><div className="flex min-w-0 items-center gap-3"><IconCalendarEvent size={16} className="shrink-0 text-gray-400" /><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{event.title}</p><p className="text-xs text-gray-500 dark:text-gray-400">{formatDate(event.date_start)} · {event.capacity_remaining}/{event.capacity_total} places</p></div></div><span className={`shrink-0 rounded-full px-2 py-1 text-2xs font-semibold ${STATUS_COLORS[event.status]}`}>{STATUS_LABELS[event.status]}</span></Link>)}</div></div>
      )}
    </div>
  );
}
