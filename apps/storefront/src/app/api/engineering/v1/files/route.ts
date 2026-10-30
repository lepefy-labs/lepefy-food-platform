import { NextResponse } from 'next/server';
import { sanitizeRepoPath } from '@/lib/engineering/explorer';
import { githubLink } from '@/lib/engineering/domain';
import { authenticateMachine } from '@/lib/engineering/server/machineAuth';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadFileSource } from '@/lib/engineering/server/repository';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_LINES = 400;

/** Machine API: GET ?path=&start=&end= (scope `read`). Indexed files only; excluded files do not exist here. */
export async function GET(request: Request) {
  const auth = await authenticateMachine(request, 'read');
  if ('response' in auth) return auth.response;

  const params = new URL(request.url).searchParams;
  const path = sanitizeRepoPath(params.get('path'));
  if (!path) return NextResponse.json({ error: 'Invalid path' }, { status: 400, headers: NO_STORE });
  const active = await getActiveRun();
  if (active.state !== 'ready') return NextResponse.json({ error: 'Index unavailable' }, { status: 503, headers: NO_STORE });

  const source = await loadFileSource(active.run.repositoryId, active.run.runId, path);
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const lines = source.content.split('\n');
  const start = Math.max(1, Number.parseInt(params.get('start') ?? '1', 10) || 1);
  const end = Math.min(lines.length, start + MAX_LINES - 1, Number.parseInt(params.get('end') ?? '', 10) || start + MAX_LINES - 1);
  return NextResponse.json({
    path, commitSha: active.run.commitSha, startLine: start, endLine: end, totalLines: lines.length,
    content: lines.slice(start - 1, end).join('\n'),
    url: githubLink(active.run.githubOwner, active.run.githubRepo, active.run.commitSha, path, start, end),
  }, { headers: NO_STORE });
}
