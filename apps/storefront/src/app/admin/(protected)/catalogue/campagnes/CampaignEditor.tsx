'use client';

import { useCallback,useEffect,useMemo,useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconChevronLeft,IconChevronRight,IconSearch } from '@tabler/icons-react';
import type { Campaign,CampaignPreview,CampaignProduct } from '@/lib/catalog/campaigns';
import { CAMPAIGN_KIND_LABEL } from '@/lib/catalog/campaigns';
import { CATALOG_CAMPAIGN_STATUS_META } from '@/lib/admin/statusRegistry';
import { formatDate,formatMoney } from '@/lib/admin/format';
import { isoToShopLocal,shopLocalToIso } from '@/lib/time/shopTime';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import Badge from '../../../_components/ui/Badge';
import Button,{ ButtonLink } from '../../../_components/ui/Button';
import { useConfirm,useUnsavedChangesGuard } from '../../../_components/ui/ConfirmDialog';
import { FormField,Input,Select,Textarea } from '../../../_components/ui/Form';
import InlineAlert,{ ErrorText } from '../../../_components/ui/InlineAlert';
import { Panel } from '../../../_components/ui/Panel';
import { useAdminMutation } from '../../../_components/ui/useAdminMutation';
import { useAdminToast } from '../../../_components/ui/Toaster';
import CampaignActions from './CampaignActions';

interface SearchProduct {
  id:string;name:string;slug:string;barcode_value:string|null;price:number;stock:number;
  min_order_quantity:number;active:boolean;selected:boolean;eligibility:'eligible'|'warning'|'conflict';
}
interface SearchResult { products:SearchProduct[];total:number;page:number;size:number }
interface FormValue {
  name:string;description:string;kind:'promotion'|'novelty'|'mixed';discount_mode:'percent'|'fixed'|'custom';
  discount_value:string;promo_starts_at:string;promo_ends_at:string;promo_until_sold_out:boolean;
  novelty_starts_at:string;novelty_ends_at:string;
}

function initialForm(campaign:Campaign|null):FormValue {
  const week = new Date(Date.now()+7*86_400_000).toISOString();
  return {
    name:campaign?.name ?? '',description:campaign?.description ?? '',kind:campaign?.kind ?? 'promotion',
    discount_mode:campaign?.discount_mode ?? 'percent',discount_value:String(campaign?.discount_value ?? 10),
    promo_starts_at:isoToShopLocal(campaign?.promo_starts_at),promo_ends_at:isoToShopLocal(campaign?.promo_ends_at),
    promo_until_sold_out:campaign?.promo_until_sold_out ?? false,
    novelty_starts_at:isoToShopLocal(campaign?.novelty_starts_at),
    novelty_ends_at:isoToShopLocal(campaign?.novelty_ends_at ?? week),
  };
}

const STEPS = ['Informations','Choisir les produits','Configuration','Vérification'] as const;
const ISSUE:Record<string,string> = {
  manual_promotion:'Promotion manuelle déjà active',campaign_conflict:'Autre campagne promotionnelle',
  insufficient_stock:'Stock inférieur au minimum d’achat',invalid_discount:'Réduction non valide',
};

export default function CampaignEditor({ initial,canManage,currency,initialStep,preselectedIds=[] }:{
  initial:{ campaign:Campaign;products:CampaignProduct[] }|null;canManage:boolean;currency:string;
  initialStep?:number;preselectedIds?:string[];
}) {
  const router = useRouter();
  const mutation = useAdminMutation();
  const toast = useAdminToast();
  const [ask,confirmDialog] = useConfirm();
  const [campaign,setCampaign] = useState<Campaign|null>(initial?.campaign ?? null);
  const [selected,setSelected] = useState<CampaignProduct[]>(initial?.products ?? []);
  const [selectedPage,setSelectedPage] = useState(1);
  const [form,setForm] = useState<FormValue>(() => initialForm(initial?.campaign ?? null));
  const [dirty,setDirty] = useState(false);
  const [step,setStep] = useState(Math.min(4,Math.max(1,initialStep ?? (initial?.campaign.status==='draft' ? 1 : 4))));
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('');
  const [active,setActive] = useState('');
  const [available,setAvailable] = useState('');
  const [page,setPage] = useState(1);
  const [search,setSearch] = useState<SearchResult|null>(null);
  const [searchError,setSearchError] = useState<string|null>(null);
  const [searchRevision,setSearchRevision] = useState(0);
  const [categories,setCategories] = useState<Array<{ id:string;name:string }>>([]);
  const [preview,setPreview] = useState<CampaignPreview|null>(null);
  const [previewPage,setPreviewPage] = useState(1);
  const [previewError,setPreviewError] = useState<string|null>(null);
  const guard = useUnsavedChangesGuard(dirty);
  const editable = canManage && (!campaign || campaign.status==='draft' || campaign.status==='suspended');
  const selectedCount = campaign?.product_count ?? selected.length;
  const id = campaign?.id;

  const setField = <K extends keyof FormValue>(key:K,value:FormValue[K]) => {
    setForm((current) => ({ ...current,[key]:value }));setDirty(true);setPreview(null);
  };
  const config = useMemo(() => ({
    name:form.name,description:form.description,kind:form.kind,discount_mode:form.discount_mode,
    discount_value:form.discount_mode==='custom' ? null : Number(form.discount_value),
    promo_starts_at:shopLocalToIso(form.promo_starts_at),promo_ends_at:shopLocalToIso(form.promo_ends_at),
    promo_until_sold_out:form.promo_until_sold_out,
    novelty_starts_at:shopLocalToIso(form.novelty_starts_at),novelty_ends_at:shopLocalToIso(form.novelty_ends_at),
  }),[form]);

  const reloadDetail = useCallback(async () => {
    if (!id) return;
    const response = await fetch(`/api/admin/catalogue/campagnes/${id}`,{ cache:'no-store' });
    if (!response.ok) return;
    const data = await response.json() as { campaign:Campaign;products:CampaignProduct[] };
    setCampaign(data.campaign);setSelected(data.products);setSelectedPage(1);
  },[id]);

  async function loadMoreSelected() {
    if (!id || selected.length>=selectedCount) return;
    const nextPage = selectedPage+1;
    const response = await fetch(`/api/admin/catalogue/campagnes/${id}?selectedPage=${nextPage}`,{ cache:'no-store' });
    if (!response.ok) { toast.error('Impossible de charger les autres produits.');return; }
    const data = await response.json() as { campaign:Campaign;products:CampaignProduct[] };
    setSelected((current) => [...current,...data.products]);setSelectedPage(nextPage);
  }

  useEffect(() => {
    if (step!==2) return;
    void fetch('/api/admin/catalogue/categories',{ cache:'no-store' })
      .then((response) => response.ok ? response.json() as Promise<{ categories:Array<{ id:string;name:string }> }> : Promise.reject())
      .then((data) => setCategories(data.categories)).catch(() => setCategories([]));
  },[step]);

  useEffect(() => {
    if (!id || step!==2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ page:String(page) });
      if (query.trim()) params.set('q',query.trim());
      if (category) params.set('category',category);
      if (active) params.set('active',active);
      if (available) params.set('available',available);
      try {
        const response = await fetch(`/api/admin/catalogue/campagnes/${id}/search?${params}`,{ signal:controller.signal,cache:'no-store' });
        if (!response.ok) throw new Error('Recherche indisponible.');
        setSearch(await response.json() as SearchResult);setSearchError(null);
      } catch (error) { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Recherche indisponible.'); }
    },query ? 300 : 0);
    return () => { controller.abort();window.clearTimeout(timer); };
  },[id,step,query,category,active,available,page,searchRevision]);

  useEffect(() => {
    if (!id || step!==4) return;
    const controller = new AbortController();
    void fetch(`/api/admin/catalogue/campagnes/${id}/preview?page=${previewPage}`,{ signal:controller.signal,cache:'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('Aperçu indisponible.');return response.json() as Promise<CampaignPreview>; })
      .then((data) => { setPreview(data);setPreviewError(null); })
      .catch(() => { if (!controller.signal.aborted) setPreviewError('Aperçu indisponible. Réessayez.'); });
    return () => controller.abort();
  },[id,step,campaign?.version,previewPage]);

  async function save(nextStep:number) {
    if (!editable) { setStep(nextStep);return; }
    if (!form.name.trim()) { mutation.setError('Indiquez le nom de la campagne.');setStep(1);return; }
    if (!campaign) {
      const created = await mutation.run<{ id:string }>('/api/admin/catalogue/campagnes',{
        body:config,withKey:true,refresh:false,errorToast:true,
      });
      if (!created) return;
      if (preselectedIds.length) await mutation.run(`/api/admin/catalogue/campagnes/${created.id}/products`,{
        body:{ ids:preselectedIds },refresh:false,errorToast:true,
      });
      setDirty(false);
      router.push(`/admin/catalogue/campagnes/${created.id}?step=${nextStep}`);
      return;
    }
    if (dirty) {
      const updated = await mutation.run<{ version:number }>(`/api/admin/catalogue/campagnes/${campaign.id}`,{
        method:'PATCH',body:{ ...config,version:campaign.version },refresh:false,errorToast:true,
      });
      if (!updated) return;
      setCampaign((current) => current ? { ...current,...config,version:updated.version } as Campaign : current);
      setDirty(false);toast.success('Brouillon enregistré.');
    }
    setStep(nextStep);
  }

  async function selectProducts(ids:string[]|null,all=false,remove=false) {
    if (!id || !editable) return;
    const response = await mutation.run<{ added?:number;removed?:number }>(`/api/admin/catalogue/campagnes/${id}/products`,{
      method:remove ? 'DELETE' : 'POST',refresh:false,errorToast:true,
      body:remove ? { ids,all } : { ids,all,filters:{ q:query,category:category || null,
        active:active ? active==='true' : null,available:available ? available==='true' : null } },
    });
    if (!response) return;
    if (!remove && response.added===0) toast.error('Aucun produit admissible à ajouter parmi cette sélection.');
    else toast.success(remove ? `${response.removed ?? 0} produit(s) retiré(s).` : `${response.added ?? 0} produit(s) ajouté(s).`);
    await reloadDetail();setSearchRevision((v) => v+1);setPreview(null);
  }

  async function override(productId:string,raw:string) {
    if (!id) return;
    const result = await mutation.run(`/api/admin/catalogue/campagnes/${id}/products`,{
      method:'PATCH',body:{ productId,price:raw || null },refresh:false,errorToast:true,
    });
    if (result) { await reloadDetail();setPreview(null);toast.success('Prix enregistré.'); }
  }

  async function publish() {
    if (!campaign || !preview || preview.blocked>0 || preview.version!==campaign.version) return;
    if (!(await ask({ title:'Publier cette campagne ?',description:`${preview.count} produits seront concernés selon les calendriers affichés.`,confirmLabel:'Publier' }))) return;
    const result = await mutation.run(`/api/admin/catalogue/campagnes/${campaign.id}/action`,{
      body:{ action:campaign.status==='suspended' ? 'resume' : 'publish',version:preview.version },
      withKey:true,refresh:false,errorToast:true,
    });
    if (result) { toast.success('Campagne publiée.');await reloadDetail();router.refresh(); }
  }

  return <div className="mx-auto w-full max-w-6xl pb-28 sm:pb-8">
    <AdminPageHeader title={campaign?.name || 'Nouvelle campagne'}
      breadcrumb={[{ label:'Catalogue',href:'/admin/catalogue' },{ label:'Campagnes',href:'/admin/catalogue/campagnes' },{ label:campaign?.name || 'Nouvelle' }]}
      meta={campaign ? <Badge tone={CATALOG_CAMPAIGN_STATUS_META[campaign.status]!.tone} dot>{CATALOG_CAMPAIGN_STATUS_META[campaign.status]!.label}</Badge> : undefined}
      description={campaign?.status==='running' ? 'Cette campagne est visible selon son calendrier et la disponibilité des produits.' : 'Préparez les produits, vérifiez les prix puis publiez.'}
      actions={campaign ? <CampaignActions campaign={campaign} canManage={canManage} /> : undefined} />
    <nav aria-label="Étapes de la campagne" className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-a-border bg-a-surface p-1">
      {STEPS.map((label,index) => <button key={label} type="button" onClick={() => { if (!dirty && (campaign || index===0)) setStep(index+1); }}
        aria-current={step===index+1 ? 'step' : undefined}
        className={`min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold ${step===index+1 ? 'bg-a-selected text-a-brand-fg' : 'text-a-text-2 hover:bg-a-hover'}`}>
        {index+1}. {label}</button>)}
    </nav>
    {dirty && <InlineAlert tone="warning" className="mb-4" title="Modifications non enregistrées">Enregistrez avant la vérification ou de quitter cette page.</InlineAlert>}
    {campaign?.last_error && <InlineAlert tone="danger" className="mb-4" title="Une transition nécessite une vérification">Ouvrez la vérification pour voir les produits concernés.</InlineAlert>}
    <ErrorText message={mutation.error || searchError || previewError} className="mb-4" />

    {step===1 && <Panel title="Informations" description="Donnez un nom clair à cette initiative. Les détails restent modifiables en brouillon ou après suspension.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nom de la campagne" required><Input value={form.name} maxLength={160} disabled={!editable} onChange={(e) => setField('name',e.target.value)} /></FormField>
        <FormField label="Type" required><Select value={form.kind} disabled={!editable} onChange={(e) => setField('kind',e.target.value as FormValue['kind'])}>
          {Object.entries(CAMPAIGN_KIND_LABEL).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
        </Select></FormField>
        <FormField label="Description interne" optional className="sm:col-span-2"><Textarea rows={3} value={form.description} disabled={!editable} onChange={(e) => setField('description',e.target.value)} /></FormField>
      </div>
    </Panel>}

    {step===2 && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Panel title="Choisir les produits" description="La recherche et les filtres parcourent tout le catalogue de votre boutique.">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="relative sm:col-span-3"><span className="sr-only">Rechercher par nom, code ou code-barres</span><IconSearch size={16} aria-hidden="true" className="absolute left-3 top-3 text-a-text-3" /><Input className="pl-9" type="search" value={query} placeholder="Nom, code ou code-barres" onChange={(e) => { setQuery(e.target.value);setPage(1); }} /></label>
          <Select aria-label="Catégorie" value={category} onChange={(e) => { setCategory(e.target.value);setPage(1); }}><option value="">Toutes les catégories</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          <Select aria-label="Statut" value={active} onChange={(e) => { setActive(e.target.value);setPage(1); }}><option value="">Tous les statuts</option><option value="true">Actifs</option><option value="false">Inactifs</option></Select>
          <Select aria-label="Disponibilité" value={available} onChange={(e) => { setAvailable(e.target.value);setPage(1); }}><option value="">Toute disponibilité</option><option value="true">Quantité achetable</option><option value="false">Stock sous le minimum</option></Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-a-text-2">
          <span aria-live="polite">{search ? `${search.total} produits trouvés` : 'Recherche en cours…'}</span>
          {editable && search && search.total>0 && <Button size="sm" variant="secondary" disabled={mutation.pending} onClick={() => void selectProducts(null,true)}>Ajouter les produits admissibles parmi {search.total} résultats</Button>}
        </div>
        <div className="mt-3 space-y-2">
          {search?.products.map((p) => <div key={p.id} className="flex items-center gap-3 rounded-lg border border-a-border bg-a-surface p-3">
            <input type="checkbox" className="h-5 w-5 accent-a-brand" aria-label={`Sélectionner ${p.name}`} checked={p.selected} disabled={!editable || mutation.pending || (!p.selected && p.eligibility==='conflict')}
              onChange={() => void selectProducts([p.id],false,p.selected)} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-a-text">{p.name}</p><p className="text-xs text-a-text-3">{p.slug} · {formatMoney(p.price,currency)} · stock {p.stock}</p></div>
            <Badge tone={p.eligibility==='eligible' ? 'success' : p.eligibility==='conflict' ? 'danger' : 'warning'}>{p.eligibility==='eligible' ? 'Sélectionnable' : p.eligibility==='conflict' ? 'Exclu · conflit promo' : !p.active ? 'Inactif' : 'Stock limité'}</Badge>
          </div>)}
          {search?.products.length===0 && <p className="py-8 text-center text-sm text-a-text-3">Aucun produit ne correspond aux filtres.</p>}
        </div>
        {search && search.total>search.size && <div className="mt-3 flex items-center justify-between"><Button variant="secondary" size="sm" disabled={page<=1} onClick={() => setPage((v) => v-1)}><IconChevronLeft size={15} />Précédent</Button><span className="text-sm text-a-text-2">Page {page} / {Math.ceil(search.total/search.size)}</span><Button variant="secondary" size="sm" disabled={page>=Math.ceil(search.total/search.size)} onClick={() => setPage((v) => v+1)}>Suivant<IconChevronRight size={15} /></Button></div>}
      </Panel>
      <Panel title={`Sélection · ${selectedCount}`} description="Conservée lorsque les filtres et la page changent.">
        {selectedCount===0 ? <p className="text-sm text-a-text-3">Aucun produit sélectionné.</p> : <>
          <div className="max-h-80 space-y-2 overflow-y-auto">{selected.map((item) => <div key={item.product_id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{item.products?.name ?? 'Produit indisponible'}</span>{editable && <button type="button" className="text-a-brand-fg hover:underline" onClick={() => void selectProducts([item.product_id],false,true)}>Retirer</button>}</div>)}</div>
          {selected.length<selectedCount && <Button size="sm" variant="secondary" className="mt-3" onClick={() => void loadMoreSelected()}>Afficher plus</Button>}
          {editable && <Button size="sm" variant="ghost" className="mt-3" onClick={() => void selectProducts(null,true,true)}>Vider la sélection</Button>}
        </>}
      </Panel>
    </div>}

    {step===3 && <div className="space-y-4">
      {(form.kind==='promotion' || form.kind==='mixed') && <Panel title="Promotion" description="Le prix normal reste la référence; le prix payé change seulement pendant la promotion.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Règle de réduction"><Select value={form.discount_mode} disabled={!editable} onChange={(e) => setField('discount_mode',e.target.value as FormValue['discount_mode'])}><option value="percent">Pourcentage global</option><option value="fixed">Réduction fixe en euros</option><option value="custom">Prix par produit</option></Select></FormField>
          {form.discount_mode!=='custom' && <FormField label={form.discount_mode==='percent' ? 'Réduction (%)' : 'Réduction (€)'}><Input type="number" min="0.01" step="0.01" value={form.discount_value} disabled={!editable} onChange={(e) => setField('discount_value',e.target.value)} /></FormField>}
          <FormField label="Début" hint="Vide = dès la publication."><Input type="datetime-local" value={form.promo_starts_at} disabled={!editable} onChange={(e) => setField('promo_starts_at',e.target.value)} /></FormField>
          <FormField label="Fin" hint="Vide = sans date de fin."><Input type="datetime-local" value={form.promo_ends_at} disabled={!editable} onChange={(e) => setField('promo_ends_at',e.target.value)} /></FormField>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.promo_until_sold_out} disabled={!editable} onChange={(e) => setField('promo_until_sold_out',e.target.checked)} className="h-5 w-5 accent-a-brand" />Terminer pour un produit à épuisement de son stock</label>
        </div>
        {selectedCount>0 && <div className="mt-5 border-t border-a-border pt-4"><h3 className="text-sm font-semibold">Prix particuliers</h3><p className="mt-1 text-xs text-a-text-3">Facultatif avec une règle commune. Un prix particulier remplace cette règle pour le produit.</p><div className="mt-3 max-h-96 space-y-2 overflow-y-auto">{selected.map((item) => <div key={item.product_id} className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate text-sm">{item.products?.name}</span><Input className="max-w-32" type="number" min="0.01" step="0.01" aria-label={`Prix particulier de ${item.products?.name}`} defaultValue={item.override_promo_price ?? ''} disabled={!editable} onBlur={(e) => { if (String(item.override_promo_price ?? '')!==e.target.value) void override(item.product_id,e.target.value); }} /></div>)}</div>{selected.length<selectedCount && <Button size="sm" variant="secondary" className="mt-3" onClick={() => void loadMoreSelected()}>Afficher plus</Button>}</div>}
      </Panel>}
      {(form.kind==='novelty' || form.kind==='mixed') && <Panel title="Nouveautés" description="Le badge Nouveau se retire automatiquement à la fin choisie.">
        <div className="mb-3 flex flex-wrap gap-2">{[7,15,30].map((days) => <Button key={days} variant="secondary" size="sm" disabled={!editable} onClick={() => setField('novelty_ends_at',isoToShopLocal(new Date(Date.now()+days*86_400_000).toISOString()))}>{days} jours</Button>)}</div>
        <div className="grid gap-4 sm:grid-cols-2"><FormField label="Début" hint="Vide = dès la publication."><Input type="datetime-local" value={form.novelty_starts_at} disabled={!editable} onChange={(e) => setField('novelty_starts_at',e.target.value)} /></FormField><FormField label="Fin" required><Input type="datetime-local" value={form.novelty_ends_at} disabled={!editable} onChange={(e) => setField('novelty_ends_at',e.target.value)} /></FormField></div>
      </Panel>}
      <InlineAlert tone="info">Toutes les dates sont saisies à l’heure de Paris. Les changements programmés sont appliqués par la vérification automatique du catalogue.</InlineAlert>
    </div>}

    {step===4 && <div className="space-y-4">
      <Panel title="Vérification avant publication" description="L’aperçu est calculé sur le serveur et revérifié dans la transaction de publication.">
        <div className="grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-a-text-3">Campagne</p><p className="font-semibold">{campaign?.name ?? form.name}</p></div><div><p className="text-xs text-a-text-3">Type</p><p>{CAMPAIGN_KIND_LABEL[form.kind]}</p></div><div><p className="text-xs text-a-text-3">Produits</p><p>{preview?.count ?? selectedCount}</p></div></div>
        <p className="mt-3 text-sm text-a-text-2">Promotion : {form.promo_starts_at ? formatDate(shopLocalToIso(form.promo_starts_at),'datetime') : 'dès publication'} → {form.promo_ends_at ? formatDate(shopLocalToIso(form.promo_ends_at),'datetime') : 'sans fin'} · Nouveauté : {form.kind==='promotion' ? 'non' : formatDate(shopLocalToIso(form.novelty_ends_at),'datetime')}</p>
      </Panel>
      {preview && preview.blocked>0 && <InlineAlert tone="danger" title={`${preview.blocked} produit(s) empêchent la publication`}>Retirez ces produits ou corrigez leur prix, stock ou campagne incompatible, puis actualisez la vérification.</InlineAlert>}
      {preview && preview.blocked===0 && <InlineAlert tone="success" title="Prête à publier">La publication recontrôlera les données pour éviter une modification concurrente.</InlineAlert>}
      <Panel title="Impact sur les produits" description="Les produits inactifs restent masqués aux clients. Le stock détermine leur achat possible.">
        {!preview ? <p className="text-sm text-a-text-3">Calcul de l’aperçu…</p> : <><div className="max-h-[500px] overflow-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-a-border text-xs text-a-text-3"><th className="p-2">Produit</th><th className="p-2">Normal</th><th className="p-2">Promo</th><th className="p-2">Réduction</th><th className="p-2">Résultat</th></tr></thead><tbody>{preview.products.map((p) => <tr key={p.id} className="border-b border-a-border"><td className="p-2 font-medium">{p.name}</td><td className="p-2 tabular-nums">{formatMoney(p.regular_price,currency)}</td><td className="p-2 tabular-nums">{p.promo_price ? formatMoney(p.promo_price,currency) : '—'}</td><td className="p-2 tabular-nums">{p.promo_price && p.regular_price ? `−${Math.round((1-p.promo_price/p.regular_price)*100)} %` : '—'}</td><td className="p-2">{p.issue ? <Badge tone="danger">{ISSUE[p.issue] ?? p.issue}</Badge> : !p.active ? <Badge tone="warning">Inactif · masqué</Badge> : p.stock<p.min_order_quantity ? <Badge tone="warning">Non achetable</Badge> : <Badge tone="success">Visible</Badge>}</td></tr>)}</tbody></table></div>{preview.count>preview.size && <div className="mt-3 flex items-center justify-between"><Button variant="secondary" size="sm" disabled={previewPage<=1} onClick={() => setPreviewPage((v) => v-1)}>Précédent</Button><span className="text-sm text-a-text-2">Page {previewPage} / {Math.ceil(preview.count/preview.size)}</span><Button variant="secondary" size="sm" disabled={previewPage>=Math.ceil(preview.count/preview.size)} onClick={() => setPreviewPage((v) => v+1)}>Suivant</Button></div>}</>}
      </Panel>
    </div>}

    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t border-a-border bg-a-surface px-4 py-3 sm:static sm:mt-5 sm:rounded-lg sm:border">
      <div>{step>1 && <Button variant="secondary" onClick={() => setStep(step-1)}><IconChevronLeft size={16} />Retour</Button>}{step===1 && <ButtonLink href="/admin/catalogue/campagnes">Annuler</ButtonLink>}</div>
      <div className="flex items-center gap-2">{step>1 && editable && <Button variant="secondary" loading={mutation.pending} onClick={() => void save(step)}>Enregistrer le brouillon</Button>}
        {step<4 ? <Button loading={mutation.pending} onClick={() => void save(step+1)}>{step===1 && !campaign ? 'Créer la campagne' : 'Continuer'}<IconChevronRight size={16} /></Button>
          : editable && <Button loading={mutation.pending} disabled={!preview || preview.blocked>0 || selectedCount===0 || dirty} onClick={() => void publish()}>{campaign?.status==='suspended' ? 'Reprendre' : 'Publier'}</Button>}</div>
    </div>
    {guard}{confirmDialog}
  </div>;
}
