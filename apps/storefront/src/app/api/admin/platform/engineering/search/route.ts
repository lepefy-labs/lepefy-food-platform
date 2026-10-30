import { NextResponse } from 'next/server';
import { requireEngineeringApi } from '@/lib/engineering/server/guard';
import { searchEngineering } from '@/lib/engineering/server/search';
import { SEARCH_KINDS, type SearchKind } from '@/lib/engineering/search/contract';

export const dynamic = 'force-dynamic';

/** GET ?q=&module=&kind=symbol,file — platform owner only; the Hub has no scoping parameter besides the module. */
export async function GET(request: Request) {
  const denied = await requireEngineeringApi('engineering.view');
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const kinds = (params.get('kind') ?? '').split(',').filter((kind): kind is SearchKind => (SEARCH_KINDS as readonly string[]).includes(kind));
  const moduleKey = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(params.get('module') ?? '') ? params.get('module') : null;

  const outcome = await searchEngineering({ query: params.get('q') ?? '', moduleKey, kinds });
  if (outcome.state === 'invalid') return NextResponse.json({ error: 'Query too short', reason: outcome.reason }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  if (outcome.state === 'unavailable') return NextResponse.json({ error: 'Index unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(outcome, { headers: { 'Cache-Control': 'no-store' } });
}
