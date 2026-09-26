import { test, expect } from '@playwright/test';
import { classifyDigest, renderDigestHtml, tenantClock } from '../../src/lib/notifications/dailyOrderDigest';

const settings = {daily_digest_prepare_hours:24,daily_digest_pickup_hours:48,daily_digest_payment_hours:48,daily_digest_shipping_hours:72};
const now = new Date('2026-09-26T06:00:00Z');
test('8am follows Rome summer and winter time',()=>{
  expect(tenantClock(now,'Europe/Rome').hour).toBe(8);
  expect(tenantClock(new Date('2026-12-26T07:00:00Z'),'Europe/Rome').hour).toBe(8);
});
test('only paid orders become normal preparation tasks',()=>{
  const base={full_name:'Marie',email:null,status:'new',fulfillment_type:'delivery',
    updated_at:'2026-09-26T05:00:00Z',shipping_normalized_status:null,shipping_sync_error:null,
    shipping_provider_reference:null,shipping_estimated_delivery_at:null,shipping_provider_synced_at:null,shipping_tracking_events:null};
  const actions=classifyDigest([
    {...base,id:'11111111-a',payment_status:'paid',created_at:'2026-09-26T05:00:00Z'},
    {...base,id:'22222222-a',payment_status:'paid',created_at:'2026-09-24T05:00:00Z'},
    {...base,id:'33333333-a',payment_status:'pending',created_at:'2026-09-26T05:00:00Z'},
  ],[],settings,now,'https://shop.example.com');
  expect(actions.map(a=>a.priority)).toEqual(['urgent','urgent','today']);
  expect(actions.find(a=>a.key==='order:33333333-a')?.reason).toContain('incohérent');
});
test('unverified WhatsApp preorders remain purchase intents',()=>{
  const actions=classifyDigest([],[
    {id:'44444444-a',full_name:'Client WA',email:null,phone:'123',origin:'assisted',
      status:'awaiting_verification',created_at:'2026-09-24T05:00:00Z',
      declared_payment_at:'2026-09-24T05:00:00Z'},
  ],settings,now,'https://shop.example.com');
  expect(actions[0]!.priority).toBe('urgent');
  expect(actions[0]!.url).toContain('/admin/orders/precommandes/');
  expect(actions[0]!.action).toContain('avant de confirmer');
});
test('HTML escapes customer input and limits card count',()=>{
  const items=Array.from({length:7},(_,index)=>({
    key:'order:'+index,priority:'urgent' as const,reference:'#'+index,
    customer:'<img onerror=alert(1)>',reason:'retard',action:'préparer',
    url:'https://example.com/admin/orders/'+index,createdAt:now.toISOString(),
  }));
  const html=renderDigestHtml('Tenant','2026-09-26',items,[], 'https://example.com/admin',null);
  expect(html).not.toContain('<img onerror=');
  expect(html).toContain('Et 2 autres');
});

test('stalled managed shipping needs manual attention without pretending delivery failed',()=>{
  const actions=classifyDigest([{
    id:'55555555-a',full_name:'Marie',email:null,status:'shipped',payment_status:'paid',
    fulfillment_type:'delivery',created_at:'2026-09-20T05:00:00Z',updated_at:'2026-09-20T05:00:00Z',
    shipping_normalized_status:'in_transit',shipping_sync_error:null,shipping_provider_reference:'PK1',
    shipping_estimated_delivery_at:null,shipping_provider_synced_at:'2026-09-26T05:00:00Z',
    shipping_tracking_events:[{occurredAt:'2026-09-20T05:00:00Z'}],
  }],[],settings,now,'https://shop.example.com');
  expect(actions).toHaveLength(1);
  expect(actions[0]!.priority).toBe('monitor');
  expect(actions[0]!.reason).toContain('événement transporteur');
});
