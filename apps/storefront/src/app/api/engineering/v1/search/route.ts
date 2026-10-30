import { NextResponse } from 'next/server';
import { authenticateMachine } from '@/lib/engineering/server/machineAuth';
import { searchEngineering } from '@/lib/engineering/server/search';
import { SEARCH_KINDS, type SearchKind } from '@/lib/engineering/search/contract';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Machine API: GET ?q=&module=&kind= with `Authorization: Bearer lpe_eng_…` (scope `search`). No cookies, no tenant. */
export async function GET(request: Request) {
  const auth = await authenticateMachine(request, 'search');
  if ('response' in auth) return auth.response;

  const params = new URL(request.url).searchParams;
  const kinds = (params.get('kind') ?? '').split(',').filter((kind): kind is SearchKind => (SEARCH_KINDS as readonly string[]).includes(kind));
  const moduleKey = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(params.get('module') ?? '') ? params.get('module') : null;
  const outcome = await searchEngineering({ query: params.get('q') ?? '', moduleKey, kinds }, { actor: { kind: 'machine', clientId: auth.client.clientId } });
  if (outcome.state === 'invalid') return NextResponse.json({ error: 'Invalid query', reason: outcome.reason }, { status: 400, headers: NO_STORE });
  if (outcome.state === 'unavailable') return NextResponse.json({ error: 'Index unavailable' }, { status: 503, headers: NO_STORE });
  return NextResponse.json(outcome, { headers: NO_STORE });
}
