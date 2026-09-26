import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getNotificationRecipients } from '@/lib/notifications/getNotificationRecipients';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { notifyN8n } from '@/lib/events/notifyN8n';
import {
  classifyDigest, renderDigestHtml, tenantClock,
  type DigestOrder, type DigestPreorder, type DigestSettings,
} from '@/lib/notifications/dailyOrderDigest';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

interface TenantRow extends DigestSettings {
  id:string; daily_digest_timezone:string; daily_digest_include_empty:boolean;
}
async function readAll<T>(db:SupabaseClient,table:'orders'|'checkout_sessions',
  tenant:string,columns:string):Promise<T[]>{
  const result:T[]=[];
  // Paginated, never silently truncate a tenant's action list.
  for(let start=0;start<10000;start+=1000){
    let query=db.from(table).select(columns).eq('tenant_id',tenant);
    query=table==='orders'
      ?query.not('status','in','("delivered","cancelled")')
      :query.in('status',['draft','open','awaiting_verification']);
    const {data,error}=await query.order('created_at',{ascending:true}).order('id',{ascending:true}).range(start,start+999);
    if(error)throw error;
    const batch=(data??[]) as T[];
    result.push(...batch);
    if(batch.length<1000)return result;
  }
  throw new Error('digest_row_limit_exceeded');
}
async function deliverTenant(db:SupabaseClient,tenant:TenantRow,now:Date):Promise<string>{
  const clock=tenantClock(now,tenant.daily_digest_timezone);
  if(clock.hour!==8)return 'not_due';
  const recipients=await getNotificationRecipients(db,tenant.id,'notify_daily_digest');
  if(!recipients.length)return 'no_recipients';
  const branding=await getTenantNotificationContext(tenant.id);
  if(!branding?.storefrontUrl)throw new Error('missing_tenant_storefront');
  const {data:claimed,error:claimError}=await db.rpc('claim_tenant_daily_digest',
    {p_tenant:tenant.id,p_date:clock.localDate});
  if(claimError)throw claimError;
  if(!claimed)return 'already_claimed';
  try{
    const [orders,preorders,prior]=await Promise.all([
      readAll<DigestOrder>(db,'orders',tenant.id,
        'id,full_name,email,payment_status,status,fulfillment_type,created_at,updated_at,shipping_normalized_status,shipping_sync_error,shipping_provider_reference,shipping_estimated_delivery_at,shipping_provider_synced_at,shipping_tracking_events'),
      readAll<DigestPreorder>(db,'checkout_sessions',tenant.id,
        'id,full_name,email,phone,origin,status,created_at,declared_payment_at'),
      db.from('tenant_daily_digest_runs').select('snapshot')
        .eq('tenant_id',tenant.id).eq('status','accepted').lt('local_date',clock.localDate)
        .order('local_date',{ascending:false}).limit(1).maybeSingle(),
    ]);
    if(prior.error)throw prior.error;
    const adminUrl=branding.storefrontUrl.replace(/\/$/,'')+'/admin';
    const items=classifyDigest(orders,preorders,tenant,now,branding.storefrontUrl.replace(/\/$/,''));
    const snapshot={keys:items.map(i=>i.key),counts:{
      urgent:items.filter(i=>i.priority==='urgent').length,
      today:items.filter(i=>i.priority==='today').length,
      monitor:items.filter(i=>i.priority==='monitor').length,
    }};
    const old=(prior.data?.snapshot??{}) as {keys?:string[]};
    const previousKeys=Array.isArray(old.keys)?old.keys:[];
    if(!items.length&&!tenant.daily_digest_include_empty){
      const {error}=await db.from('tenant_daily_digest_runs').update({status:'skipped',snapshot})
        .eq('tenant_id',tenant.id).eq('local_date',clock.localDate).eq('status','processing');
      if(error)throw error;
      return 'empty';
    }
    const html=renderDigestHtml(branding.tenantName,clock.localDate,items,previousKeys,
      adminUrl,branding.branding.logoUrl);
    const subject='[Rapport du matin] '+snapshot.counts.urgent+' urgentes · '+
      snapshot.counts.today+' à traiter · '+branding.tenantName;
    const accepted=await notifyN8n('/webhook/daily-order-digest',{
      ...branding,notificationType:'daily_order_digest',recipients,
      localDate:clock.localDate,generatedAt:now.toISOString(),
      idempotencyKey:tenant.id+':'+clock.localDate,subject,html,items,
      snapshot,adminUrl,
    });
    if(!accepted)throw new Error('n8n_not_accepted');
    const {error}=await db.from('tenant_daily_digest_runs').update({
      status:'accepted',accepted_at:new Date().toISOString(),snapshot,
    }).eq('tenant_id',tenant.id).eq('local_date',clock.localDate).eq('status','processing');
    if(error)throw error;
    return 'accepted';
  }catch(error){
    const code=error instanceof Error?error.message.slice(0,60):'unknown';
    console.error('[daily digest] failed',tenant.id,code);
    await db.from('tenant_daily_digest_runs').update({status:'failed',error_code:code})
      .eq('tenant_id',tenant.id).eq('local_date',clock.localDate).eq('status','processing');
    return 'failed';
  }
}
/**
 * Protected hourly scheduler entry point. Each tenant is processed only at 08:00
 * in its own IANA timezone, including summer/winter clock changes.
 */
export async function POST(request:NextRequest){
  const secret=process.env.DAILY_DIGEST_CRON_SECRET??'';
  const provided=request.headers.get('authorization')?.replace(/^Bearer /i,'')??'';
  if(!secret||!provided||Buffer.byteLength(secret)!==Buffer.byteLength(provided)||
    !timingSafeEqual(Buffer.from(secret),Buffer.from(provided))){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }
  const db=createServiceClient(),now=new Date();
  const {data,error}=await db.from('tenants').select(
    'id,daily_digest_timezone,daily_digest_include_empty,daily_digest_prepare_hours,daily_digest_pickup_hours,daily_digest_payment_hours,daily_digest_shipping_hours',
  ).eq('active',true).eq('daily_digest_enabled',true);
  if(error)return NextResponse.json({error:'Daily digest schema unavailable'},{status:503});
  const outcomes:Record<string,number>={accepted:0,failed:0,not_due:0,no_recipients:0,already_claimed:0,empty:0};
  for(const tenant of (data??[]) as TenantRow[]){
    try{
      const result=await deliverTenant(db,tenant,now);
      outcomes[result]=(outcomes[result]??0)+1;
    }catch(cause){
      outcomes.failed++;
      console.error('[daily digest] unexpected failure',tenant.id,cause);
    }
  }
  return NextResponse.json({outcomes},{status:outcomes.failed?503:200});
}
