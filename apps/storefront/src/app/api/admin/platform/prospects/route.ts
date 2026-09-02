import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { dashboard, listProspects, startRun } from '@/lib/platform/prospects/repository';
import { actionSchema } from '@/lib/platform/prospects/validation';
import { selectEnrichment, stepRun } from '@/lib/platform/prospects/pipeline';
import { CrawlError } from '@/lib/platform/prospects/websiteFetcher';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export async function GET(req:NextRequest) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  try {
    const [list,summary] = await Promise.all([listProspects(req.nextUrl.searchParams),dashboard()]);
    return NextResponse.json({...list,...summary},{headers:{'Cache-Control':'no-store'}});
  } catch { return NextResponse.json({error:'Données indisponibles. Vérifiez la migration 101 et réessayez.'},{status:503}); }
}
export async function POST(req:NextRequest) {
  const denied = await requirePlatformOwner(); if (denied) return denied;
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({error:'Origine refusée.'},{status:403});
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({error:'Paramètres invalides.'},{status:400});
  try {
    const input = parsed.data; let run;
    if (input.action === 'step') run = await stepRun(input.runId);
    else if (input.action === 'discover') run = await startRun('discovery',input.filters);
    else {
      const ids = await selectEnrichment(input.ids,input.qualified);
      if (!ids.length) return NextResponse.json({error:'Aucun candidat à actualiser : cache récent, opposition ou sélection vide.'},{status:400});
      run = await startRun('enrichment',{ids:ids.sort(),osm:input.osm});
    }
    return NextResponse.json({run},{headers:{'Cache-Control':'no-store'}});
  } catch (e) {
    if (e instanceof CrawlError && e.retrySeconds) return NextResponse.json({error:'Un traitement est déjà actif. Réessayez dans quelques instants.'},
      {status:429,headers:{'Retry-After':String(e.retrySeconds)}});
    return NextResponse.json({error:'Traitement indisponible. Vérifiez la migration 101 ou réessayez.'},{status:503});
  }
}
