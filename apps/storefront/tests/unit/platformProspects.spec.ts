import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
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
  const p = {naf_ape_code:'47.11B',has_website:true,has_instagram:true,has_facebook:true,whatsapp_url:'https://wa.me/33123456789',
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
  const node = {id:1,type:'node',lat:48.85,lon:2.35,tags:{name:identity.business_name}};
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
function fakeHttp(pages:{status:number;headers?:Record<string,string>;body?:string}[]) {
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
  await expect(fetcher.safeGet('https://shop.example/')).rejects.toThrow('private_address');
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
    await expect(fetcher.safeGet('https://shop.example/',{maxBytes:5})).rejects.toThrow(code);
  }
});

for (const status of [401,403]) {
  test('all prospect HTTP handlers deny before data access: '+status,async () => {
    const { NextRequest, NextResponse } = await import('next/server');
    const mocks = {
      '@/lib/auth/requirePlatformOwner':{requirePlatformOwner:async()=>NextResponse.json({error:'Denied'},{status})},
      '@/lib/platform/prospects/repository':{},
      '@/lib/platform/prospects/validation':{},
      '@/lib/platform/prospects/pipeline':{},
      '@/lib/platform/prospects/websiteFetcher':{},
      '@/lib/platform/prospects/deduplication':{},
      '@/lib/platform/prospects/scoring':{},
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
