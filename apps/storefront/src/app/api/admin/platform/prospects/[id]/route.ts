import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getProspect, patchProspect } from '@/lib/platform/prospects/repository';
import { scoreProspect } from '@/lib/platform/prospects/scoring';
import { salesSchema } from '@/lib/platform/prospects/validation';
import { normalizeUrl } from '@/lib/platform/prospects/websiteFetcher';
import { normalizedDomain } from '@/lib/platform/prospects/deduplication';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:{id:string}}) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  if (!z.string().uuid().safeParse(params.id).success) return NextResponse.json({error:'Identifiant invalide.'},{status:400});
  try {
    const prospect = await getProspect(params.id);
    return prospect ? NextResponse.json({prospect},{headers:{'Cache-Control':'no-store'}}) : NextResponse.json({error:'Prospect introuvable.'},{status:404});
  } catch { return NextResponse.json({error:'Prospect indisponible. Vérifiez la migration 101.'},{status:503}); }
}
export async function PATCH(req:NextRequest,{params}:{params:{id:string}}) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({error:'Origine refusée.'},{status:403});
  const parsed = salesSchema.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(params.id).success || !parsed.success) return NextResponse.json({error:'Champs invalides.'},{status:400});
  let website:string | null;
  try { website = parsed.data.website_url ? normalizeUrl(parsed.data.website_url).href : null; }
  catch { return NextResponse.json({error:'URL HTTP(S) publique requise.'},{status:400}); }
  try {
    const current = await getProspect(params.id); if (!current) return NextResponse.json({error:'Prospect introuvable.'},{status:404});
    const reset = website !== current.website_url ? {website_checked_at:null,has_website:website ? true : null,
      has_ecommerce:null,has_online_ordering:null,has_delivery:null,has_events:null,has_loyalty:null,
      website_title:null,website_description:null,evidence:[],technologies:[],
      crawl_status:'pending' as const, crawl_error:null} : {};
    await patchProspect(params.id,{...parsed.data,website_url:website,domain:normalizedDomain(website),...reset,
      ...scoreProspect({...current,...reset,website_url:website})});
    return NextResponse.json({ok:true});
  } catch { return NextResponse.json({error:'Enregistrement impossible.'},{status:503}); }
}
