import { expect, test } from '@playwright/test';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { assessProspect, collectionEvidence } from '../../src/lib/platform/prospects/assessment';
import { nameSimilarity, matchBusiness } from '../../src/lib/platform/prospects/matching';
import { mergeEnrichment } from '../../src/lib/platform/prospects/mergeEnrichment';
import type * as Google from '../../src/lib/platform/prospects/googlePlaces';
import type * as Enrichment from '../../src/lib/platform/prospects/enrichment';
import { PassThrough } from 'node:stream';
import * as ts from 'typescript';
import { CONFIG } from '../../src/lib/platform/prospects/config';
import { scoreProspect, qualificationLevel } from '../../src/lib/platform/prospects/scoring';
import { normalizedDomain, sameIdentity } from '../../src/lib/platform/prospects/deduplication';
import { parseWebsite, socialLink } from '../../src/lib/platform/prospects/websiteParser';
import { normalizeUrl, isPublicAddress, resolvePublic, CrawlError } from '../../src/lib/platform/prospects/websiteFetcher';
import { robotsAllows } from '../../src/lib/platform/prospects/robots';
import type * as Fetcher from '../../src/lib/platform/prospects/websiteFetcher';
import type * as Sirene from '../../src/lib/platform/prospects/sirene';
import type * as Osm from '../../src/lib/platform/prospects/osm';
import type * as Website from '../../src/lib/platform/prospects/website';
import type { Identity, Prospect } from '../../src/lib/platform/prospects/types';
function load<T>(path:string,mocks:Record<string,unknown>):T {
  const filename = resolve(__dirname,'../../src',path);
  const nativeRequire = createRequire(filename);
  const output = ts.transpileModule(readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  const exports:Record<string,unknown> = {};
  runInNewContext(output,{exports,process,console,URL,URLSearchParams,Buffer,setTimeout,clearTimeout,
    require:(id:string) => id in mocks ? mocks[id] : nativeRequire(id)},{filename});
  return exports as T;
}
const fixture = (name:string) => readFileSync(resolve(__dirname,'fixtures',name),'utf8');
const identity:Identity = {business_name:'Épicerie du Marché',country:'FR',postal_code:'75011',address:'1 rue du Marché',discovery_source:'fixture'};
test('unknown digital presence earns no absence points or invented problems',() => {
  const result = scoreProspect({naf_ape_code:'47.11B'});
  expect(result.fit_score).toBe(20); expect(result.detected_problems).toEqual([]);
  expect(result.recommended_modules).toEqual([]);
});
test('score deterministic, configurable and capped',() => {
  const p = {crawl_status:'completed' as const,website_checked_at:new Date().toISOString(),naf_ape_code:'47.11B',has_website:true,has_instagram:true,has_facebook:true,whatsapp_url:'https://wa.me/33123456789',
    has_ecommerce:false,has_online_ordering:false,has_catering:true,has_events:true,has_delivery:true,has_multiple_locations:true};
  expect(scoreProspect(p)).toEqual(scoreProspect(p)); expect(scoreProspect(p).fit_score).toBe(100);
  expect(scoreProspect({has_website:true},{...CONFIG.weights,website:9}).fit_score).toBe(9);
  expect(scoreProspect(p).recommended_modules).toEqual(expect.arrayContaining(['Boutique / Catalogue','Orders','Événementiel','Shipping']));
  expect(scoreProspect(p).recommended_modules).not.toContain('Nala');
});
for (const [score,level] of [[0,'low'],[39,'low'],[40,'medium'],[64,'medium'],[65,'high'],[79,'high'],[80,'priority'],[100,'priority']] as const) {
  test('qualification boundary '+score,() => expect(qualificationLevel(score)).toBe(level));
}
test('qualification boundaries can change',() => expect(qualificationLevel(50,{medium:20,high:40,priority:60})).toBe('high'));
test('URL canonicalization and protocol/credential/port rejection',() => {
  expect(normalizeUrl(' HTTPS://EXAMPLE.COM:443/contact#team ').href).toBe('https://example.com/contact');
  for (const value of ['file:///etc/passwd','ftp://example.com','http://user:pass@example.com','http://localhost','http://service.internal','https://example.com:8080']) expect(() => normalizeUrl(value)).toThrow();
});
for (const address of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.1.1',
  '192.0.2.1','198.51.100.3','203.0.113.2','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','64:ff9b::a00:1','2002:7f00:1::','2001:db8::1']) {
  test('SSRF blocks '+address,() => expect(isPublicAddress(address)).toBe(false));
}
test('public DNS is resolved once and mixed answers are rejected',async () => {
  let calls=0;
  expect(await resolvePublic('example.com',async () => {calls++;return [{address:'93.184.216.34',family:4}];})).toEqual({address:'93.184.216.34',family:4});
  expect(calls).toBe(1);
  await expect(resolvePublic('example.com',async () => [{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}])).rejects.toThrow('private_address');
  const numeric = normalizeUrl('http://2130706433').hostname;
  await expect(resolvePublic(numeric)).rejects.toThrow('private_address');
});
test('parser extracts public business contacts and ranks at most two relevant targets',() => {
  const p = parseWebsite(fixture('prospect-food.html'),'https://epicerie.example/');
  expect(p.title).toBe('Épicerie du Marché'); expect(p.emails).toEqual(['contact@epicerie.example']);
  expect(p.phones).toContain('+33123456789'); expect(p.social.instagram_url).toContain('instagram.com/epiceriedumarche');
  expect(p.social.facebook_url).toBe('https://www.facebook.com/epiceriedumarche');
  expect(p.links.slice(0,2).map(l => new URL(l.url).pathname)).toEqual(['/contact','/boutique']);
  expect(p.links.some(l => l.url.includes('elsewhere') || l.url.includes('.pdf'))).toBe(false);
  expect(p.signals).toMatchObject({has_ecommerce:true,has_catering:true,has_events:true,has_delivery:true,has_loyalty:true,has_whatsapp_ordering:true});
});
test('site-builder technology alone does not claim ecommerce',() => {
  const p = parseWebsite(fixture('prospect-wix.html'),'https://shop.example/');
  expect(p.technologies).toEqual(['Wix']); expect(p.signals.has_ecommerce).toBeUndefined();
  expect(parseWebsite('<script src="https://cdn.shopify.com/assets/store.js"></script>','https://shop.example/').signals.has_ecommerce).toBe(true);
  expect(parseWebsite('<div class="woocommerce-product">Produit</div>','https://shop.example/').signals.has_ecommerce).toBe(true);
});
test('malformed JSON-LD and social host spoofing are ignored',() => {
  expect(parseWebsite('<script type="application/ld+json">{broken</script>','https://shop.example/').emails).toEqual([]);
  expect(socialLink('https://instagram.com.evil.example/shop')).toBeNull();
  expect(socialLink('https://facebook.com/sharer/sharer.php')).toBeNull();
});
test('dedup preserves different SIRET and ambiguous identities',() => {
  const a = {...identity,siret:'12345678900001',website_url:'https://www.shop.example/a'};
  expect(sameIdentity(a,{...a,website_url:null})).toBe(true);
  expect(sameIdentity(a,{...a,siret:'12345678900002'})).toBe(false);
  expect(sameIdentity(identity,{...identity,business_name:'Epicerie du Marche'})).toBe(true);
  expect(sameIdentity({...identity,address:null},{...identity,address:null})).toBe(false);
  expect(normalizedDomain('https://WWW.SHOP.EXAMPLE/catalogue')).toBe('shop.example');
});
test('robots longest match and explicit Lepefy policy respected',() => {
  expect(robotsAllows('User-agent: *\nDisallow: /\nAllow: /contact','/contact')).toBe(true);
  expect(robotsAllows('User-agent: *\nDisallow: /private*','/private/a')).toBe(false);
  expect(robotsAllows('User-agent: *\nAllow: /\nUser-agent: LepefyProspects\nDisallow: /','/')).toBe(false);
});
test('SIRENE mock filters establishments rather than using an out-of-area head office',() => {
  const sirene = load<typeof Sirene>('lib/platform/prospects/sirene.ts',{'./repository':{},'./providers':{}});
  const e = {siret:'12345678900001',activite_principale:'47.11B',etat_administratif:'A',region:'11',code_postal:'75011',libelle_commune:'PARIS',adresse:'1 rue'};
  const result = sirene.mapSirene({total_pages:1,results:[{nom_complet:'Épicerie',etat_administratif:'A',matching_etablissements:[e,
    {...e,siret:'12345678900002',region:'84'},{...e,siret:'12345678900003',etat_administratif:'F'},
    {...e,siret:'12345678900004',activite_principale:'62.01Z'}]}]},
    {country:'FR',region:'11',department:'75',city:'Paris',codes:['47.11B'],activeOnly:true,limit:100});
  expect(result.map(p => p.siret)).toEqual(['12345678900001']);
});
test('OSM requires one unambiguous nearby business match',() => {
  const osm = load<typeof Osm>('lib/platform/prospects/osm.ts',{'./repository':{},'./providers':{}});
  const p = {...identity,latitude:48.85,longitude:2.35} as Prospect;
  const node = {id:1,type:'node',lat:48.85,lon:2.35,tags:{name:identity.business_name,shop:'convenience'}};
  expect(osm.matchOsm(p,[node])?.id).toBe(1);
  expect(osm.matchOsm(p,[node,{...node,id:2}])).toBeNull();
  expect(osm.matchOsm(p,[{...node,lat:49}])).toBeNull();
});
test('website failure preserves unknown signals; HTML is not persisted',async () => {
  const cached:unknown[]=[];
  const website = load<typeof Website>('lib/platform/prospects/website.ts',{
    './repository':{getCache:async()=>null,putCache:async (_key:string,value:unknown)=>cached.push(value),claimGate:async()=>true},
    './providers':{cacheKey:()=> 'cache'},
    './websiteFetcher':{safeGet:async()=>{throw new CrawlError('access_blocked',403);},CrawlError,normalizeUrl},
  });
  const result = await website.enrichWebsite({...identity,website_url:'https://shop.example/'} as Prospect);
  expect(result.crawl_status).toBe('blocked'); expect(result.has_ecommerce).toBeNull();
  expect(result.website_checked_at).toBeNull(); expect(JSON.stringify(cached)).not.toContain('<html');
});
function fakeHttp(pages:{status:number;headers?:Record<string,string>;body?:string | Buffer}[]) {
  const calls:{url:string;address:string}[]=[];
  return {calls,transport:{request(url:URL,options:{lookup:(host:string,opts:unknown,cb:(err:unknown,address:string)=>void)=>void},callback:(res:unknown)=>void) {
    const req = new EventEmitter() as EventEmitter & {end:()=>void;destroy:(e:Error)=>void};
    req.destroy = e => {req.emit('error',e);req.emit('close');};
    req.end = () => queueMicrotask(() => {
      options.lookup(url.hostname,{},(_err,address)=>calls.push({url:url.href,address}));
      const page=pages.shift()!; const res=Object.assign(new PassThrough(),{statusCode:page.status,headers:{'content-type':'text/html',...page.headers}});
      res.on('end',()=>req.emit('close')); res.on('close',()=>req.emit('close'));
      callback(res); res.end(page.body ?? '');
    });
    return req;
  }}};
}
test('HTTP connection uses pinned public address and revalidates redirects',async () => {
  const http=fakeHttp([{status:302,headers:{location:'http://127.0.0.1/secret'}}]);
  const fetcher=load<typeof Fetcher>('lib/platform/prospects/websiteFetcher.ts',{
    'node:http':http.transport,'node:https':http.transport,'node:dns/promises':{lookup:async()=>[{address:'93.184.216.34',family:4}]},
  });
  await expect(Promise.resolve(fetcher.safeGet('https://shop.example/'))).rejects.toThrow('private_address');
  expect(http.calls).toEqual([{url:'https://shop.example/',address:'93.184.216.34'}]);
});
test('HTTP enforces response type, size and 429 backoff',async () => {
  for (const [page,code] of [
    [{status:200,headers:{'content-type':'application/pdf'}},'unsupported_content'],
    [{status:200,headers:{'content-length':'10000000'}},'response_too_large'],
    [{status:200,body:'123456789'},'response_too_large'],
    [{status:429,headers:{'retry-after':'120'}},'upstream_backoff'],
  ] as const) {
    const http=fakeHttp([page]);
    const fetcher=load<typeof Fetcher>('lib/platform/prospects/websiteFetcher.ts',{
      'node:http':http.transport,'node:https':http.transport,'node:dns/promises':{lookup:async()=>[{address:'93.184.216.34',family:4}]},
    });
    await expect(Promise.resolve(fetcher.safeGet('https://shop.example/',{maxBytes:5}))).rejects.toThrow(code);
  }
});

for (const status of [401,403]) {
  test('all prospect HTTP handlers deny before data access: '+status,async () => {
    const mocks = {
      '@/lib/auth/requirePlatformOwner':{requirePlatformOwner:async()=>NextResponse.json({error:'Denied'},{status})},
      '@/lib/platform/prospects/repository':{},
      '@/lib/platform/prospects/validation':{},
      '@/lib/platform/prospects/pipeline':{},
      '@/lib/platform/prospects/websiteFetcher':{},
      '@/lib/platform/prospects/deduplication':{},
      '@/lib/platform/prospects/scoring':{},
      '@/lib/platform/prospects/googlePlaces':{},
      '@/lib/platform/prospects/assessment':{},
    };
    type Collection = typeof import('../../src/app/api/admin/platform/prospects/route');
    type Detail = typeof import('../../src/app/api/admin/platform/prospects/[id]/route');
    const collection=load<Collection>('app/api/admin/platform/prospects/route.ts',mocks);
    const detail=load<Detail>('app/api/admin/platform/prospects/[id]/route.ts',mocks);
    const req=new NextRequest('https://lepefy.example/api/admin/platform/prospects');
    expect((await collection.GET(req)).status).toBe(status);
    expect((await collection.POST(req)).status).toBe(status);
    expect((await detail.GET(req,{params:{id:'any'}})).status).toBe(status);
    expect((await detail.PATCH(req,{params:{id:'any'}})).status).toBe(status);
  });
}

test('website never fetches more than homepage and two internal targets',async () => {
  const calls:string[]=[];
  const website = load<typeof Website>('lib/platform/prospects/website.ts',{
    './repository':{getCache:async()=>null,putCache:async()=>{},claimGate:async()=>true},
    './providers':{cacheKey:()=> 'cache'},
    './websiteFetcher':{safeGet:async(url:string)=>{calls.push(url);return {url,status:200,body:fixture('prospect-food.html')};},CrawlError,normalizeUrl},
  });
  const result=await website.enrichWebsite({...identity,website_url:'https://epicerie.example/'} as Prospect);
  expect(calls).toEqual(['https://epicerie.example/','https://epicerie.example/contact','https://epicerie.example/boutique']);
  expect(result.crawl_status).toBe('completed');
});
test('blocked child page prevents absence claims',async () => {
  let calls=0;
  const website=load<typeof Website>('lib/platform/prospects/website.ts',{
    './repository':{getCache:async()=>null,putCache:async()=>{},claimGate:async()=>true},
    './providers':{cacheKey:()=> 'cache'},
    './websiteFetcher':{safeGet:async(url:string)=>{if(calls++) throw new CrawlError('access_blocked',403);return {url,status:200,body:fixture('prospect-wix.html')};},CrawlError,normalizeUrl},
  });
  const result=await website.enrichWebsite({...identity,website_url:'https://shop.example/'} as Prospect);
  expect(result.crawl_status).toBe('partial'); expect(result.has_ecommerce).toBeNull(); expect(result.has_online_ordering).toBeNull();
});

const caterer={...identity,business_name:'SARL TATA PAO',legal_name:'TATA PAO SAS',siret:'12345678900001',
  naf_ape_code:'56.21Z',business_category:'Traiteurs',latitude:48.85,longitude:2.35,city:'Paris',
  address:'1 rue du Marché',has_catering:true,has_multiple_locations:true,evidence:[],technologies:[],
  crawl_status:'pending',website_checked_at:null,last_enriched_at:null,website_url:null} as unknown as Prospect;
test('business normalization preserves commercial words and strips safe legal forms',()=>{
  expect(nameSimilarity('TATA PAO','SARL TATA PAO SAS')).toBe(1);
  expect(nameSimilarity('TATA PAO','Tata Pao Traiteur')).toBe(0.9);
  expect(nameSimilarity('Épicerie du Marché','epicerie du marche')).toBe(1);
  expect(nameSimilarity('Traiteur','Autre Traiteur')).toBeLessThan(0.65);
});
const osmFixture={id:7,type:'node',lat:48.8501,lon:2.35,tags:{name:'Tata Pao Traiteur',craft:'caterer',
  'addr:postcode':'75011','addr:housenumber':'1','addr:street':'rue du Marché',website:'https://traiteur.example/'}};
test('OSM confidence handles legal/trade names and explains strong location',()=>{
  const osm=load<typeof Osm>('lib/platform/prospects/osm.ts',{'./repository':{},'./providers':{}});
  const r=osm.matchOsmConfidence(caterer,[osmFixture]);
  expect(r.matched).toBe(true);expect(r.confidence).toBeGreaterThanOrEqual(85);
  expect(r.reasons.join(' ')).toContain('Distance');
  expect(osm.matchOsmConfidence(caterer,[{...osmFixture,tags:{...osmFixture.tags,name:'TATA PAO'}}]).matched).toBe(true);
});
test('OSM rejects ambiguity, distance, wrong category, postcode and weak name',()=>{
  const osm=load<typeof Osm>('lib/platform/prospects/osm.ts',{'./repository':{},'./providers':{}});
  expect(osm.matchOsmConfidence(caterer,[osmFixture,{...osmFixture,id:8}]).ambiguous).toBe(true);
  for(const node of [
    {...osmFixture,lat:49},
    {...osmFixture,tags:{...osmFixture.tags,craft:'hairdresser'}},
    {...osmFixture,tags:{...osmFixture.tags,name:'Autre traiteur'}},
    {...osmFixture,tags:{...osmFixture.tags,'addr:postcode':'75012'}},
    {...osmFixture,tags:{...osmFixture.tags,'ref:FR:SIRET':'12345678900002'}},
  ])expect(osm.matchOsmConfidence(caterer,[node]).matched).toBe(false);
});
test('exact SIRET wins but duplicate exact identities remain ambiguous',()=>{
  const osm=load<typeof Osm>('lib/platform/prospects/osm.ts',{'./repository':{},'./providers':{}});
  const node={...osmFixture,tags:{'ref:FR:SIRET':caterer.siret!}};
  expect(osm.matchOsmConfidence(caterer,[node]).confidence).toBe(100);
  expect(osm.matchOsmConfidence(caterer,[node,{...node,id:8}]).matched).toBe(false);
});
test('name without corroborating location never auto-matches',()=>{
  expect(matchBusiness(caterer,[{id:'a',names:['TATA PAO'],food:true}],x=>x).matched).toBe(false);
});
test('SIRENE-only caterer remains provisional with low completeness',()=>{
  expect(scoreProspect(caterer).fit_score).toBe(40);
  expect(assessProspect(caterer)).toMatchObject({score_state:'provisional',data_completeness:25,ordering_maturity:'unknown',digital_maturity:'unknown'});
  expect(scoreProspect({...caterer,has_ecommerce:false,crawl_status:'blocked'}).fit_score).toBe(40);
});
const hostedHtml='<title>Tata Pao Traiteur</title><h1>Tata Pao Traiteur</h1><p>Notre service traiteur prépare vos événements avec livraison. Commandez nos menus pour votre réception.</p><form><label>Demande de commande</label><button>Envoyer pour confirmation</button></form><a href="https://order.example/checkout">Commander et payer</a><a href="https://wa.me/33123456789">Contact WhatsApp</a>';
test('hosted food, external checkout and request form produce evidence-based maturity',()=>{
  const parsed=parseWebsite(hostedHtml,'https://tata.eatbu.com/');
  expect(parsed.technologies).toContain('Eatbu / DISH');
  expect(parsed.signals.has_ecommerce).toBeUndefined();
  const p={...caterer,website_url:'https://tata.eatbu.com/',...parsed.signals,evidence:parsed.evidence};
  expect(assessProspect(p)).toMatchObject({fragmented_digital_stack:true,digital_maturity:'fragmented',ordering_maturity:'transactional'});
  const manual=parseWebsite(hostedHtml.replace('<a href="https://order.example/checkout">Commander et payer</a>',''),'https://tata.eatbu.com/');
  expect(assessProspect({...caterer,website_url:'https://tata.eatbu.com/',...manual.signals,evidence:manual.evidence,...manual.social})).toMatchObject({ordering_maturity:'request_based',digital_maturity:'fragmented'});
  expect(scoreProspect({...caterer,website_url:'https://tata.eatbu.com/',has_website:true,has_instagram:true,...manual.signals,evidence:manual.evidence,...manual.social}).fit_score).toBeGreaterThanOrEqual(80);
});
test('WhatsApp contact and link-in-bio do not imply ordering',()=>{
  const parsed=parseWebsite('<p>Contactez notre équipe WhatsApp pour toute information.</p><a href="https://wa.me/33123456789">WhatsApp</a>','https://linktr.ee/shop');
  expect(parsed.signals.has_whatsapp_ordering).toBeUndefined();
  expect(parsed.signals.has_online_ordering).toBeUndefined();
  expect(parsed.evidence.some(e=>e.signal==='hosted_presence')).toBe(true);
});
test('integrated commerce earns no artificial missing-commerce points',()=>{
  const parsed=parseWebsite('<script src="https://cdn.shopify.com/store.js"></script><a href="/checkout">Payer mon panier</a>','https://shop.example/');
  const p={...caterer,...parsed.signals,evidence:parsed.evidence};
  expect(assessProspect(p).ordering_maturity).toBe('integrated');
  expect(scoreProspect(p).score_breakdown.some(r=>r.rule.includes('non détecté'))).toBe(false);
});
for(const [encoding,compress] of [['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]] as const) {
  test('bounded '+encoding+' HTML supports public compression and rejects bombs',async()=>{
    for(const tooLarge of [false,true]) {
      const body=compress(Buffer.from(tooLarge ? 'x'.repeat(20000) : '<html>Public</html>'));
      const http=fakeHttp([{status:200,headers:{'content-encoding':encoding},body}]);
      const fetcher=load<typeof Fetcher>('lib/platform/prospects/websiteFetcher.ts',{'node:http':http.transport,'node:https':http.transport,
        'node:dns/promises':{lookup:async()=>[{address:'93.184.216.34',family:4}]}});
      if(tooLarge)await expect(Promise.resolve(fetcher.safeGet('https://shop.example/',{maxBytes:1000}))).rejects.toThrow('response_too_large');
      else expect((await fetcher.safeGet('https://shop.example/',{maxBytes:1000})).body).toBe('<html>Public</html>');
    }
  });
}
test('failed and partial crawls preserve successful evidence and verified contacts',()=>{
  const previous={...caterer,website_url:'https://verified.example/',phone:'+33123456789',has_ecommerce:true,
    crawl_status:'completed',website_checked_at:new Date().toISOString(),technologies:['Shopify'],
    evidence:[{signal:'has_ecommerce',source:'https://verified.example/',value:'Checkout'}],notes:'Private sales note'} as Prospect;
  for(const status of ['partial','failed','blocked'] as const) {
    const patch=mergeEnrichment(previous,{website_url:'https://wrong.example/',phone:'999999999',has_ecommerce:null,
      crawl_status:status,website_checked_at:null,evidence:[collectionEvidence('website',{status})],technologies:[],notes:'overwrite'});
    const p={...previous,...patch};
    expect(p.website_url).toBe(previous.website_url);expect(p.phone).toBe(previous.phone);
    expect(p.has_ecommerce).toBe(true);expect(p.website_checked_at).toBe(previous.website_checked_at);
    expect(p.evidence).toContainEqual(previous.evidence[0]);expect(p.technologies).toContain('Shopify');expect(p.notes).toBe(previous.notes);
  }
});
test('quota reservations are durable and concurrent; monthly rollover is independent',async()=>{
  const google=load<typeof Google>('lib/platform/prospects/googlePlaces.ts',{'./repository':{}});
  const rows=new Set<string>();
  const storage={last:async(prefix:string)=>Math.max(0,...[...rows].filter(k=>k.startsWith(prefix)).map(k=>Number(k.slice(prefix.length)))),
    insert:async(key:string)=>{if(rows.has(key))return false;rows.add(key);return true;}};
  const september=new Date('2026-09-01T00:00:00Z');
  const results=await Promise.all(Array.from({length:10},()=>google.reserveGoogleRequest(3,storage,september)));
  expect(results.filter(Boolean)).toHaveLength(3);expect(rows.size).toBe(3);
  expect(await google.reserveGoogleRequest(3,storage,september)).toBe(false);
  expect(await google.reserveGoogleRequest(3,storage,new Date('2026-10-01T00:00:00Z'))).toBe(true);
});
test('Google never requests when disabled, quota exhausted, or quota storage fails',async()=>{
  const oldEnabled=process.env.PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED,oldKey=process.env.GOOGLE_PLACES_API_KEY;
  try {
    const google=load<typeof Google>('lib/platform/prospects/googlePlaces.ts',{'./repository':{getCache:async()=>null,claimGate:async()=>true}});
    let calls=0;
    const request=async()=>{calls++;return [];};
    delete process.env.GOOGLE_PLACES_API_KEY;process.env.PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED='false';
    expect((await google.createGoogleProvider(request,async()=>true).lookup(caterer)).status).toBe('disabled');
    process.env.GOOGLE_PLACES_API_KEY='fixture-only';process.env.PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED='true';
    expect((await google.createGoogleProvider(request,async()=>false).lookup(caterer)).status).toBe('quota_exhausted');
    expect((await google.createGoogleProvider(request,async()=>{throw new Error('db');}).lookup(caterer)).status).toBe('quota_unavailable');
    expect(calls).toBe(0);
    const order:string[]=[];
    await google.createGoogleProvider(async()=>{order.push('request');return [];},async()=>{order.push('reserved');return true;}).lookup(caterer);
    expect(order).toEqual(['reserved','request']);
  } finally {
    if(oldEnabled===undefined)delete process.env.PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED;else process.env.PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED=oldEnabled;
    if(oldKey===undefined)delete process.env.GOOGLE_PLACES_API_KEY;else process.env.GOOGLE_PLACES_API_KEY=oldKey;
  }
});
test('Google matching rejects a distant same-name business',()=>{
  const google=load<typeof Google>('lib/platform/prospects/googlePlaces.ts',{'./repository':{}});
  expect(google.matchGoogle(caterer,[{id:'fixture',displayName:{text:'TATA PAO'},location:{latitude:49,longitude:2.35},types:['caterer']}]).matched).toBe(false);
});
test('trade-name OSM discovery feeds the existing website parser without paid fallback',async()=>{
  const osm=load<typeof Osm>('lib/platform/prospects/osm.ts',{'./repository':{getCache:async()=>null,putCache:async()=>{}},
    './providers':{cacheKey:()=> 'fixture',providerJson:async()=>({elements:[osmFixture]})}});
  const website=load<typeof Website>('lib/platform/prospects/website.ts',{'./repository':{getCache:async()=>null,putCache:async()=>{},claimGate:async()=>true},
    './providers':{cacheKey:()=> 'fixture'},'./websiteFetcher':{safeGet:async(url:string)=>({url,status:200,body:hostedHtml}),CrawlError,normalizeUrl}});
  const enrichment=load<typeof Enrichment>('lib/platform/prospects/enrichment.ts',{'./osm':{},'./googlePlaces':{},'./website':{}});
  let paid=0;
  const result=await enrichment.enrichProspect(caterer,{
    free:{name:'osm',lookup:async p=>({patch:await osm.enrichOsm(p),status:'matched'})},
    fallback:{name:'google',lookup:async()=>{paid++;return {patch:{},status:'not_found'};}},website:website.enrichWebsite});
  expect(result.patch.website_url).toBe('https://traiteur.example/');
  expect(result.patch.has_events).toBe(true);expect(result.patch.has_catering).toBe(true);
  expect(result.assessment.score_state).toBe('enriched');expect(paid).toBe(0);
});

test('enrichment candidates use state, not fit score, and exclude recent retry windows',async()=>{
  const calls:string[]=[];
  const recent=new Date().toISOString();
  const rows=[{...caterer,id:'low',fit_score:20},
    {...caterer,id:'cooldown',fit_score:99,evidence:[collectionEvidence('website',{retry_at:new Date(Date.now()+60000).toISOString()})]},
    {...caterer,id:'complete',website_url:'https://shop.example/',website_checked_at:recent,last_enriched_at:recent,crawl_status:'completed',
      has_ecommerce:false,has_online_ordering:false,has_delivery:false,has_events:false,has_loyalty:false,has_whatsapp_ordering:false}];
  const query={select:()=>query,eq:(key:string)=>{calls.push(key);return query;},in:()=>query,order:()=>query,range:async()=>({data:rows,error:null})};
  const pipeline=load<typeof import('../../src/lib/platform/prospects/pipeline')>('lib/platform/prospects/pipeline.ts',{
    './repository':{db:()=>({from:()=>query}),StoreError:class extends Error{}},'./enrichment':{},'./sirene':{},
  });
  expect(await pipeline.selectEnrichment(undefined,true)).toEqual(['low']);
  expect(calls).toContain('do_not_contact');expect(calls).not.toContain('fit_score');
});
test('optimistic enrichment refuses a record changed by a manual edit',async()=>{
  const filters:unknown[]=[];
  const query={update:()=>query,eq:(key:string,value:unknown)=>{filters.push([key,value]);return query;},select:async()=>({data:[],error:null})};
  const repo=load<typeof import('../../src/lib/platform/prospects/repository')>('lib/platform/prospects/repository.ts',{
    '@/lib/supabase/server':{createServiceClient:()=>({from:()=>query})},
  });
  await expect(Promise.resolve(repo.patchEnrichment({...caterer,id:'fixture',updated_at:'old'},{phone:'new'}))).rejects.toThrow();
  expect(filters).toContainEqual(['updated_at','old']);expect(filters).toContainEqual(['do_not_contact',false]);
});
test('Google transient URL is not saved when direct verification fails',async()=>{
  const enrichment=load<typeof Enrichment>('lib/platform/prospects/enrichment.ts',{'./osm':{},'./googlePlaces':{},'./website':{}});
  const p=await enrichment.enrichProspect(caterer,{
    free:{name:'osm',lookup:async()=>({patch:{},status:'not_found'})},
    fallback:{name:'google',lookup:async()=>({status:'matched',transientWebsite:'https://candidate.example/',
      patch:{evidence:[collectionEvidence('google',{place_id:'fixture',status:'matched'})]}})},
    website:async()=>({crawl_status:'blocked',evidence:[],has_ecommerce:null}),
  });
  expect(p.patch.website_url).toBeUndefined();
  expect(JSON.stringify(p.patch)).not.toContain('candidate.example');
  expect(p.metrics.partial).toBe(1);
});
test('robots disallow, challenge pages and minimal SPAs stay unevaluated',async()=>{
  for(const [body,status] of [
    ['<html>Checking your browser cf-chl-token</html>','blocked'],
    ['<div id="app"></div><script src="/app.js"></script>','partial'],
  ] as const) {
    const website=load<typeof Website>('lib/platform/prospects/website.ts',{
      './repository':{getCache:async()=>null,putCache:async()=>{},claimGate:async()=>true},
      './providers':{cacheKey:()=> 'fixture'},
      './websiteFetcher':{safeGet:async(url:string)=>({url,status:200,body}),CrawlError,normalizeUrl},
    });
    const p=await website.enrichWebsite({...caterer,website_url:'https://shop.example/'});
    expect(p.crawl_status).toBe(status);expect(p.has_ecommerce).toBeNull();
  }
  const website=load<typeof Website>('lib/platform/prospects/website.ts',{
    './repository':{getCache:async()=>null,putCache:async()=>{},claimGate:async()=>true},
    './providers':{cacheKey:()=> 'fixture'},
    './websiteFetcher':{safeGet:async(url:string,options:{beforeRequest?:(url:URL)=>Promise<void>})=>{
      if(url.endsWith('/robots.txt'))return {url,status:200,body:'User-agent: *\nDisallow: /'};
      await options.beforeRequest?.(new URL(url));return {url,status:200,body:hostedHtml};
    },CrawlError,normalizeUrl},
  });
  expect((await website.enrichWebsite({...caterer,website_url:'https://shop.example/'})).crawl_status).toBe('blocked');
});
test('public HTTP to HTTPS and www redirects revalidate every connection',async()=>{
  const http=fakeHttp([{status:301,headers:{location:'https://www.shop.example/'}},{status:200,body:'Public page'}]);
  const fetcher=load<typeof Fetcher>('lib/platform/prospects/websiteFetcher.ts',{
    'node:http':http.transport,'node:https':http.transport,'node:dns/promises':{lookup:async()=>[{address:'93.184.216.34',family:4}]},
  });
  expect((await fetcher.safeGet('http://shop.example/')).url).toBe('https://www.shop.example/');
  expect(http.calls).toHaveLength(2);
});
