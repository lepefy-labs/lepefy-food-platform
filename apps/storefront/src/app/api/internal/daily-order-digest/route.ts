import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getNotificationRecipients } from '@/lib/notifications/getNotificationRecipients';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { deliverTenantDigest, listDigestTenants, type DigestRunnerDeps } from '@/lib/notifications/dailyDigestRunner';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

/**
 * Protected hourly scheduler entry point. Each tenant is processed only at 08:00
 * in its own IANA timezone, including summer/winter clock changes. Tenants are
 * selected from tenant_feature_settings ('daily_order_digest', enabled = true).
 */
export async function POST(request:NextRequest){
  const secret=process.env.DAILY_DIGEST_CRON_SECRET??'';
  const provided=request.headers.get('authorization')?.replace(/^Bearer /i,'')??'';
  if(!secret||!provided||Buffer.byteLength(secret)!==Buffer.byteLength(provided)||
    !timingSafeEqual(Buffer.from(secret),Buffer.from(provided))){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }
  const db=createServiceClient(),now=new Date();
  let selection:Awaited<ReturnType<typeof listDigestTenants>>;
  try{
    selection=await listDigestTenants(db);
  }catch(cause){
    console.error('[daily digest] settings unavailable',cause);
    return NextResponse.json({error:'Daily digest schema unavailable'},{status:503});
  }
  const deps:DigestRunnerDeps={
    db,
    getRecipients:(tenantId)=>getNotificationRecipients(db,tenantId,'notify_daily_digest'),
    getBranding:(tenantId)=>getTenantNotificationContext(tenantId),
    notify:notifyN8n,
  };
  const outcomes:Record<string,number>={accepted:0,failed:0,not_due:0,no_recipients:0,already_claimed:0,empty:0,
    invalid_config:selection.invalid.length};
  for(const tenantId of selection.invalid)console.error('[daily digest] invalid configuration, skipped',tenantId);
  for(const tenant of selection.tenants){
    try{
      const result=await deliverTenantDigest(deps,tenant,now);
      outcomes[result]=(outcomes[result]??0)+1;
    }catch(cause){
      outcomes.failed=(outcomes.failed??0)+1;
      console.error('[daily digest] unexpected failure',tenant.tenantId,cause);
    }
  }
  return NextResponse.json({outcomes},{status:(outcomes.failed??0)>0?503:200});
}
