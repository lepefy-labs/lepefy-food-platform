'use client';

import Link from 'next/link';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Campaign } from '@/lib/catalog/campaigns';
import { CAMPAIGN_KIND_LABEL } from '@/lib/catalog/campaigns';
import Button,{ buttonClasses } from '../../_components/ui/Button';
import Dialog from '../../_components/ui/Dialog';
import { Select } from '../../_components/ui/Form';
import { useAdminMutation } from '../../_components/ui/useAdminMutation';
import { useAdminToast } from '../../_components/ui/Toaster';

export default function CampaignBulkAction({ ids,clear }:{ ids:string[];clear:()=>void }) {
  const [open,setOpen] = useState(false);
  const [campaigns,setCampaigns] = useState<Campaign[]>([]);
  const [loading,setLoading] = useState(false);
  const [loadError,setLoadError] = useState(false);
  const [chosen,setChosen] = useState('');
  const [campaignPage,setCampaignPage] = useState(1);
  const [hasMore,setHasMore] = useState(false);
  const mutation = useAdminMutation();
  const toast = useAdminToast();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);setLoadError(false);
    Promise.all(['draft','suspended'].map(async (status) => {
      const response = await fetch(`/api/admin/catalogue/campagnes?status=${status}&size=100&page=${campaignPage}`,{
        signal:controller.signal,cache:'no-store',
      });
      if (!response.ok) throw new Error('unavailable');
      return response.json() as Promise<{ campaigns:Campaign[];total:number }>;
    })).then((parts) => {
      setCampaigns((current) => campaignPage===1 ? parts.flatMap((part) => part.campaigns)
        : [...current,...parts.flatMap((part) => part.campaigns)]);
      setHasMore(parts.some((part) => part.total>campaignPage*100));
    })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[open,campaignPage]);

  async function add() {
    if (!chosen) return;
    const result = await mutation.run<{ added:number }>(`/api/admin/catalogue/campagnes/${chosen}/products`,{
      body:{ ids },refresh:false,errorToast:true,
    });
    if (!result) return;
    if (result.added===0) { toast.error('Aucun produit admissible à ajouter à cette campagne.');return; }
    toast.success(`${result.added} produit${result.added>1?'s':''} ajouté${result.added>1?'s':''} à la campagne.`);
    setOpen(false);clear();router.push(`/admin/catalogue/campagnes/${chosen}?step=2`);
  }

  return <>
    <Button variant="secondary" size="sm" onClick={() => { setCampaignPage(1);setOpen(true); }}>Ajouter à une campagne</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Ajouter les produits à une campagne"
      description={`${ids.length} produit${ids.length>1?'s':''} sélectionné${ids.length>1?'s':''}. Les conflits de prix seront vérifiés avant publication.`}
      dismissible={!mutation.pending}
      footer={<>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={mutation.pending}>Annuler</Button>
        <Button onClick={() => void add()} disabled={!chosen || mutation.pending}>Ajouter</Button>
      </>}>
      <label htmlFor="bulk-campaign" className="block text-sm font-medium">Campagne existante</label>
      <Select id="bulk-campaign" value={chosen} onChange={(event) => setChosen(event.target.value)}
        disabled={loading || loadError} className="mt-2 w-full">
        <option value="">Choisir une campagne</option>
        {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>
          {campaign.name} · {CAMPAIGN_KIND_LABEL[campaign.kind]} · {campaign.status==='draft'?'Brouillon':'Suspendue'}
        </option>)}
      </Select>
      {loading && <p className="mt-2 text-sm text-a-text-3">Chargement des campagnes…</p>}
      {loadError && <p className="mt-2 text-sm text-tone-danger-fg">Impossible de charger les campagnes.</p>}
      {!loading && !loadError && campaigns.length===0 && <p className="mt-2 text-sm text-a-text-3">Aucune campagne modifiable.</p>}
      {hasMore && <Button variant="secondary" size="sm" className="mt-3" disabled={loading} onClick={() => setCampaignPage((page) => page+1)}>Afficher plus de campagnes</Button>}
      <div className="mt-5 border-t border-a-border pt-4">
        <Link href={`/admin/catalogue/campagnes/nouvelle?products=${encodeURIComponent(ids.join(','))}`}
          className={buttonClasses({ variant:'secondary' })} onClick={() => setOpen(false)}>Créer une nouvelle campagne</Link>
      </div>
    </Dialog>
  </>;
}
