import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import type * as Enrichment from '../../src/lib/platform/prospects/enrichment';
import type { Prospect } from '../../src/lib/platform/prospects/types';

function load<T>(path:string,mocks:Record<string,unknown>):T {
  const filename=resolve(__dirname,'../../src',path),nativeRequire=createRequire(filename);
  const output=ts.transpileModule(readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  const exports:Record<string,unknown>={};
  runInNewContext(output,{exports,process,console,URL,URLSearchParams,Buffer,setTimeout,clearTimeout,
    require:(id:string)=>id in mocks ? mocks[id] : nativeRequire(id)},{filename});
  return exports as T;
}

const prospect={
  id:'fixture',business_name:'TATA EXEMPLE',legal_name:'TATA EXEMPLE SAS',siren:'123456789',siret:'12345678900001',
  naf_ape_code:'56.21Z',business_category:'Traiteurs',country:'FR',region:'11',department:'91',city:'BREUILLET',postal_code:'91650',
  address:'1 rue Exemple',latitude:48.56,longitude:2.17,website_url:null,phone:null,public_email:null,instagram_url:null,facebook_url:null,tiktok_url:null,whatsapp_url:null,
  has_multiple_locations:true,discovery_source:'fixture',source_external_id:'fixture',domain:null,identity_key:null,status:'discovered',fit_score:40,qualification_level:'medium',
  qualification_reason:null,detected_problems:[],recommended_modules:[],score_breakdown:[],evidence:[],technologies:[],website_title:null,website_description:null,
  crawl_status:'pending',crawl_http_status:null,crawl_error:null,discovered_at:new Date(0).toISOString(),last_enriched_at:null,website_checked_at:null,osm_checked_at:null,osm_metadata:{},
  last_contact_at:null,next_action_at:null,notes:null,lost_reason:null,do_not_contact:false,suppression_reason:null,suppressed_at:null,created_at:new Date(0).toISOString(),updated_at:new Date(0).toISOString(),
} as Prospect;

test('partial enrichment is diagnosed without being counted as an execution failure',async()=>{
  const enrichment=load<typeof Enrichment>('lib/platform/prospects/enrichment.ts',{'./osm':{},'./googlePlaces':{},'./website':{}});
  const result=await enrichment.enrichProspect(prospect,{
    free:{name:'osm',lookup:async()=>({patch:{},status:'not_found'})},
    fallback:{name:'google',lookup:async()=>({patch:{},status:'disabled'})},
    website:async()=>({}),
  });
  expect(result.assessment.enrichment_status).toBe('partial');
  expect(result.metrics).toMatchObject({osm_not_found:1,google_disabled:1,website_unresolved:1,partial:1,failed:0});
});

test('provider failures are separately observable while free-source evidence remains usable',async()=>{
  const enrichment=load<typeof Enrichment>('lib/platform/prospects/enrichment.ts',{'./osm':{},'./googlePlaces':{},'./website':{}});
  const result=await enrichment.enrichProspect(prospect,{
    free:{name:'osm',lookup:async()=>{throw new Error('upstream');}},
    fallback:{name:'google',lookup:async()=>({patch:{},status:'not_found'})},
    website:async()=>({}),
  });
  expect(result.metrics.osm_failed).toBe(1);
  expect(result.metrics.google_not_found).toBe(1);
  expect(result.metrics.website_unresolved).toBe(1);
  expect(result.metrics.failed).toBe(0);
});
