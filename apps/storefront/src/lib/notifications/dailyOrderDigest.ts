export type Priority = 'urgent' | 'today' | 'monitor';
export interface DigestItem {
  key: string; priority: Priority; reference: string; customer: string;
  reason: string; action: string; url: string; createdAt: string;
}
export interface DigestSettings {
  daily_digest_prepare_hours: number;
  daily_digest_pickup_hours: number;
  daily_digest_payment_hours: number;
  daily_digest_shipping_hours: number;
}
export interface DigestOrder {
  id: string; full_name: string | null; email: string | null;
  payment_status: string; status: string; fulfillment_type: string;
  created_at: string; updated_at: string;
  shipping_normalized_status: string | null; shipping_sync_error: string | null;
  shipping_provider_reference: string | null;
  shipping_estimated_delivery_at: string | null;
  shipping_provider_synced_at: string | null;
  shipping_tracking_events: Array<{occurredAt?:string}> | null;
}
export interface DigestPreorder {
  id: string; full_name: string | null; email: string | null; phone: string | null;
  origin: string; status: string; created_at: string; declared_payment_at: string | null;
}
const HOUR=3600000;
const age=(now:Date,date:string)=>Math.max(0,(now.getTime()-Date.parse(date))/HOUR);
const ref=(id:string)=>'#'+id.slice(0,8).toUpperCase();
const customer=(row:{full_name:string|null;email:string|null;phone?:string|null})=>
  row.full_name || row.email || row.phone || 'Client';
const priorities: Priority[]=['urgent','today','monitor'];
export function tenantClock(date:Date,timezone:string):{localDate:string;hour:number}{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part=(key:string)=>parts.find(p=>p.type===key)?.value ?? '';
  return {localDate:part('year')+'-'+part('month')+'-'+part('day'),hour:Number(part('hour'))};
}
/** Never treat a declared payment or an unresolved checkout as a paid order. */
export function classifyDigest(
  orders:DigestOrder[],preorders:DigestPreorder[],settings:DigestSettings,now:Date,baseUrl:string,
):DigestItem[]{
  const items:DigestItem[]=[];
  for(const order of orders){
    if(['delivered','cancelled'].includes(order.status))continue;
    const base={key:'order:'+order.id,reference:ref(order.id),customer:customer(order),
      url:baseUrl+'/admin/orders/'+encodeURIComponent(order.id),createdAt:order.created_at};
    let priority:Priority,reason:string,action:string;
    if(order.status==='stock_conflict'){
      priority='urgent';reason='Conflit de stock';action='Vérifier le stock et la résolution du paiement.';
    }else if(['exception','returned','cancelled'].includes(order.shipping_normalized_status??'')){
      priority='urgent';reason='Incident de livraison';action='Contacter le transporteur et organiser la solution client.';
    }else if(order.shipping_sync_error){
      priority='urgent';reason='Suivi transporteur en erreur';action='Vérifier la référence et relancer la synchronisation.';
    }else if(order.payment_status!=='paid'){
      priority='urgent';reason='Statut de paiement incohérent';action='Vérifier le paiement, sans confirmer automatiquement.';
    }else if(order.status==='shipped' && order.fulfillment_type==='delivery' &&
      order.shipping_provider_reference && order.shipping_estimated_delivery_at &&
      Date.parse(order.shipping_estimated_delivery_at)<now.getTime() &&
      ['in_transit','out_for_delivery','ready_for_collection'].includes(order.shipping_normalized_status??'')){
      priority='urgent';reason='Date de livraison estimée dépassée';
      action='Vérifier le suivi transporteur et contacter le client si nécessaire.';
    }else if(order.status==='shipped' && order.fulfillment_type==='delivery' &&
      order.shipping_provider_reference && ['in_transit','out_for_delivery'].includes(order.shipping_normalized_status??'')){
      const times=(order.shipping_tracking_events??[])
        .map(event=>Date.parse(event.occurredAt??'')).filter(Number.isFinite);
      const lastMove=times.length?Math.max(...times):NaN;
      if(!Number.isFinite(lastMove)||age(now,new Date(lastMove).toISOString())<settings.daily_digest_shipping_hours)continue;
      priority='monitor';reason='Aucun nouvel événement transporteur depuis '+Math.floor(age(now,new Date(lastMove).toISOString())/24)+' j';
      action='Vérifier le suivi et contacter le transporteur si nécessaire.';
    }else if(order.status==='ready_for_pickup'){
      const overdue=age(now,order.updated_at)>=settings.daily_digest_pickup_hours;
      priority=overdue?'urgent':'monitor';reason=overdue?'Retrait en retard':'Retrait en attente';
      action='Vérifier le retrait et contacter le client si nécessaire.';
    }else if(order.status==='new'||order.status==='preparing'){
      const overdue=age(now,order.created_at)>=settings.daily_digest_prepare_hours;
      priority=overdue?'urgent':'today';reason=overdue?'Préparation en retard':'Commande payée à préparer';
      action='Préparer la commande et organiser sa remise.';
    }else continue;
    items.push({...base,priority,reason,action});
  }
  for(const preorder of preorders){
    if(['cancelled','completed','expired'].includes(preorder.status))continue;
    if(preorder.origin!=='assisted'&&preorder.status!=='awaiting_verification')continue;
    const base={key:'preorder:'+preorder.id,reference:ref(preorder.id),customer:customer(preorder),
      url:baseUrl+(preorder.origin==='assisted'?'/admin/orders/precommandes/':'/admin/paiements-en-attente/')+encodeURIComponent(preorder.id),
      createdAt:preorder.created_at};
    if(preorder.status==='awaiting_verification'){
      const overdue=age(now,preorder.declared_payment_at||preorder.created_at)>=settings.daily_digest_payment_hours;
      items.push({...base,priority:overdue?'urgent':'today',reason:'Paiement externe à vérifier',
        action:'Vérifier la réception effective avant de confirmer la commande.'});
    }else if(preorder.status==='open'&&age(now,preorder.created_at)>=settings.daily_digest_payment_hours){
      items.push({...base,priority:'monitor',reason:'Lien de paiement sans confirmation',
        action:'Vérifier avant toute relance pour éviter un double paiement.'});
    }else if(preorder.status==='draft'&&age(now,preorder.created_at)>=24){
      items.push({...base,priority:'monitor',reason:'Précommande incomplète',
        action:'Compléter le brouillon ou décider de l’annuler.'});
    }
  }
  return items.sort((a,b)=>priorities.indexOf(a.priority)-priorities.indexOf(b.priority)||
    a.createdAt.localeCompare(b.createdAt)||a.key.localeCompare(b.key));
}
export function renderDigestHtml(name:string,date:string,items:DigestItem[],
  previousKeys:string[],adminUrl:string,logoUrl:string|null):string{
  const escape=(s:string)=>s.replace(/[&<>"']/g,c=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
  const count=(p:Priority)=>items.filter(i=>i.priority===p).length;
  const resolved=previousKeys.filter(k=>!items.some(i=>i.key===k)).length;
  const persistent=items.filter(i=>previousKeys.includes(i.key)).length;
  const section=(p:Priority,label:string,color:string)=>{
    const group=items.filter(i=>i.priority===p);
    if(!group.length)return '';
    return '<h2 style="color:'+color+'">'+escape(label)+' · '+group.length+'</h2>'+
      group.slice(0,5).map(i=>'<div style="border:1px solid #e2e8f0;padding:15px;border-radius:10px;margin:9px 0">'+
        '<strong>'+escape(i.reference+' · '+i.customer)+'</strong><p>'+escape(i.reason)+'</p>'+
        '<p style="color:#475569">'+escape(i.action)+'</p><a href="'+escape(i.url)+'">Voir la fiche →</a></div>').join('')+
      (group.length>5?'<p>Et '+(group.length-5)+' autres dans votre espace admin.</p>':'');
  };
  return '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172554">'+
    (logoUrl?'<img alt="" src="'+escape(logoUrl)+'" style="max-height:64px;max-width:180px">':'')+
    '<h1>Bonjour, voici vos priorités du matin</h1><p>'+escape(name)+' · '+escape(date)+'</p>'+
    '<p style="background:#f1f5f9;padding:15px;border-radius:10px"><b>'+count('urgent')+
    '</b> urgentes · <b>'+count('today')+'</b> à traiter · <b>'+count('monitor')+'</b> à surveiller</p>'+
    (previousKeys.length?'<p>Depuis le précédent rapport : '+resolved+' ne figurent plus · '+persistent+' toujours signalées.</p>':'')+
    section('urgent','Urgent','#991b1b')+section('today',"À traiter aujourd'hui",'#1d4ed8')+
    section('monitor','À surveiller','#475569')+
    '<p><a style="display:block;background:#172554;color:white;padding:15px;text-align:center;border-radius:10px" href="'+
    escape(adminUrl)+'">Ouvrir les commandes →</a></p><small>Rapport opérationnel automatique · Lepefy</small></div>';
}
