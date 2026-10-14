'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useConfirm } from '../../../_components/ui/ConfirmDialog';
import { buttonClasses } from '../../../_components/ui/Button';
import { useAdminMutation } from '../../../_components/ui/useAdminMutation';
import { useAdminToast } from '../../../_components/ui/Toaster';
import type { Campaign } from '@/lib/catalog/campaigns';

export default function CampaignActions({ campaign,canManage }:{ campaign:Campaign;canManage:boolean }) {
  const router = useRouter();
  const mutation = useAdminMutation();
  const toast = useAdminToast();
  const [ask,dialog] = useConfirm();
  async function act(action:'suspend'|'resume'|'end'|'duplicate') {
    if (action==='end' && !(await ask({ title:'Terminer la campagne ?',description:'Les prix gérés par cette campagne reviendront au prix normal.',confirmLabel:'Terminer',destructive:true }))) return;
    const result = await mutation.run<{ id:string }>(`/api/admin/catalogue/campagnes/${campaign.id}/action`,{
      body:{ action,version:campaign.version },withKey:true,refresh:false,errorToast:true,
    });
    if (!result) return;
    toast.success(action==='duplicate' ? 'Nouvelle copie créée en brouillon.' : 'Campagne mise à jour.');
    if (action==='duplicate') router.push(`/admin/catalogue/campagnes/${result.id}`);
    else router.refresh();
  }
  return <div className="flex flex-wrap items-center gap-2">
    <Link href={`/admin/catalogue/campagnes/${campaign.id}`} className={buttonClasses({ variant:'secondary',size:'sm' })}>Ouvrir</Link>
    {canManage && <>
      <button type="button" className={buttonClasses({ variant:'ghost',size:'sm' })} disabled={mutation.pending} onClick={() => void act('duplicate')}>Dupliquer</button>
      {(campaign.status==='scheduled' || campaign.status==='running') && <button type="button" className={buttonClasses({ variant:'ghost',size:'sm' })} disabled={mutation.pending} onClick={() => void act('suspend')}>Suspendre</button>}
      {campaign.status==='suspended' && <button type="button" className={buttonClasses({ variant:'ghost',size:'sm' })} disabled={mutation.pending} onClick={() => void act('resume')}>Reprendre</button>}
      {['scheduled','running','suspended'].includes(campaign.status) && <button type="button" className={buttonClasses({ variant:'ghost',size:'sm' })} disabled={mutation.pending} onClick={() => void act('end')}>Terminer</button>}
    </>}
    {dialog}
  </div>;
}
