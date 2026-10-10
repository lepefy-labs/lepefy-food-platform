'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { IconPlus } from '@tabler/icons-react';
import { CARD, CONSENT, INPUT, LABEL, PRIMARY, SECONDARY, apiJson, dateTime, phoneFromChatId } from './ui';

interface SourceRow {
  id: string;
  label: string;
  source_url: string;
  seller_chat_id: string;
  default_discount_pct: number;
  consent_status: string;
  status: string;
  last_fetched_at: string | null;
  last_fetch_status: string | null;
  last_fetch_error: string | null;
  tenants: { slug: string; name: string } | null;
  counts: Record<string, number>;
}

interface TenantOption { id: string; slug: string; name: string; flag_enabled: boolean }

export default function SourcesClient() {
  const [sources, setSources] = useState<SourceRow[] | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tenantId: '', label: '', url: '', sellerPhone: '', discountPct: '0' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await apiJson<{ sources: SourceRow[]; tenants: TenantOption[] }>('/api/admin/platform/external-catalogs');
    if (!res.ok) { setLoadError(res.error); return; }
    setLoadError(null);
    setSources(res.data.sources);
    setTenants(res.data.tenants);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const discount = Number(form.discountPct.replace(',', '.'));
    if (!form.tenantId || !form.label.trim() || !form.url.trim() || !form.sellerPhone.trim()) {
      setFormError('Tous les champs sont obligatoires.');
      return;
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 90) {
      setFormError('Remise entre 0 et 90 %.');
      return;
    }
    setSaving(true);
    const res = await apiJson<{ id: string }>('/api/admin/platform/external-catalogs', {
      method: 'POST',
      body: JSON.stringify({ ...form, discountPct: Math.round(discount * 100) / 100 }),
    });
    setSaving(false);
    if (!res.ok) { setFormError(res.error); return; }
    setShowForm(false);
    setForm({ tenantId: '', label: '', url: '', sellerPhone: '', discountPct: '0' });
    void load();
  }

  const selectedTenant = tenants.find((t) => t.id === form.tenantId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-a-text-3">
          Une source = le catalogue d’un vendeur lu pour un tenant. Rien n’est publié sans validation produit par produit.
        </p>
        <button type="button" className={PRIMARY} onClick={() => setShowForm((v) => !v)}>
          <IconPlus size={16} aria-hidden /> Ajouter une source
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className={`${CARD} grid gap-4 sm:grid-cols-2`} noValidate>
          <div>
            <label htmlFor="src-tenant" className={LABEL}>Tenant cible</label>
            <select id="src-tenant" className={INPUT} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
              <option value="">Choisir…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug}){t.flag_enabled ? '' : ' — import désactivé'}</option>
              ))}
            </select>
            {selectedTenant && !selectedTenant.flag_enabled && (
              <p className="mt-1 text-xs text-tone-warning-fg">
                Le flag « Import de catalogues WhatsApp » est désactivé pour ce tenant : lecture et application seront refusées tant qu’il n’est pas activé.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="src-label" className={LABEL}>Nom du vendeur</label>
            <input id="src-label" className={INPUT} value={form.label} maxLength={200} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Épicerie Mama Africa" />
          </div>
          <div>
            <label htmlFor="src-url" className={LABEL}>Lien du catalogue</label>
            <input id="src-url" className={INPUT} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://wa.me/c/191701838729307" inputMode="url" />
          </div>
          <div>
            <label htmlFor="src-phone" className={LABEL}>Numéro WhatsApp du vendeur</label>
            <input id="src-phone" className={INPUT} value={form.sellerPhone} onChange={(e) => setForm({ ...form, sellerPhone: e.target.value })} placeholder="+39 329 695 8822" inputMode="tel" />
            <p className="mt-1 text-xs text-a-text-3">Obligatoire : le lien wa.me/c/ contient l’identifiant du catalogue, pas le numéro.</p>
          </div>
          <div>
            <label htmlFor="src-discount" className={LABEL}>Remise par défaut (%)</label>
            <input id="src-discount" className={INPUT} value={form.discountPct} onChange={(e) => setForm({ ...form, discountPct: e.target.value })} inputMode="decimal" />
            <p className="mt-1 text-xs text-a-text-3">Appliquée après la division du prix du lot par le minimum, modifiable produit par produit.</p>
          </div>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            {formError && <p role="alert" className="mr-auto text-sm text-tone-danger-fg">{formError}</p>}
            <button type="button" className={SECONDARY} onClick={() => setShowForm(false)}>Annuler</button>
            <button type="submit" className={PRIMARY} disabled={saving}>{saving ? 'Création…' : 'Créer la source'}</button>
          </div>
        </form>
      )}

      {loadError && <p className="rounded-xl border border-tone-danger-border bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">{loadError}</p>}
      {!loadError && sources === null && <p className="text-sm text-a-text-3">Chargement…</p>}
      {sources && sources.length === 0 && (
        <div className={`${CARD} text-center`}>
          <p className="text-sm font-semibold">Aucune source</p>
          <p className="mt-1 text-sm text-a-text-3">Ajoutez le catalogue WhatsApp d’un vendeur pour commencer.</p>
        </div>
      )}
      {sources && sources.length > 0 && (
        <div className={`${CARD} divide-y divide-a-border p-0`}>
          {sources.map((s) => {
            const consent = CONSENT[s.consent_status] ?? CONSENT.missing!;
            const pending = (s.counts.new ?? 0) + (s.counts.changed ?? 0);
            return (
              <Link key={s.id} href={`/admin/platform/catalogues-whatsapp/${s.id}`} className="grid gap-2 px-5 py-4 hover:bg-a-surface-2 sm:grid-cols-[2fr_1fr_1fr_1fr] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{s.label}{s.status === 'archived' && <span className="ml-2 text-xs font-normal text-a-text-3">archivée</span>}</p>
                  <p className="truncate text-xs text-a-text-3">{phoneFromChatId(s.seller_chat_id)} · {s.source_url.replace('https://', '')}</p>
                </div>
                <p className="text-sm">{s.tenants?.name ?? '—'} <span className="text-xs text-a-text-3">{s.tenants?.slug}</span></p>
                <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${consent.cls}`}>{consent.label}</span>
                <div className="text-xs text-a-text-3">
                  <p>{s.last_fetch_status === 'failed' ? <span className="text-tone-danger-fg">Échec · {dateTime(s.last_fetched_at)}</span> : `Lu ${dateTime(s.last_fetched_at)}`}</p>
                  <p>{pending > 0 ? <span className="font-semibold text-tone-warning-fg">{pending} à traiter</span> : `${s.counts.linked ?? 0} lié(s)`}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
