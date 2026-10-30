import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

export const ENGINEERING_REPOSITORY = 'lepefy-food-platform';

export interface ActiveRun {
  repositoryId: string;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  runId: string;
  branch: string;
  commitSha: string;
  mode: string;
  activatedAt: string | null;
  counts: { files: number | null; symbols: number | null; relations: number | null; documents: number | null; chunks: number | null; excluded: number | null };
}

export type ActiveRunResult =
  | { state: 'ready'; run: ActiveRun }
  /** The schema exists but no run was ever activated. */
  | { state: 'empty' }
  /** Migration 175 missing or a read failed: the Hub reports it, it never invents a state. */
  | { state: 'unavailable' };

/**
 * The only way the Hub learns which snapshot to read. A run that is `running`, `staged`,
 * `failed` or `superseded` is never returned here, so an incomplete index cannot be shown
 * as the current one.
 */
export async function getActiveRun(): Promise<ActiveRunResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const { data: repo, error } = await db.from('engineering_repositories')
      .select('id, github_owner, github_repo, default_branch, active_run_id').eq('slug', ENGINEERING_REPOSITORY).maybeSingle();
    if (error || !repo) return { state: 'unavailable' };
    if (!repo.active_run_id) return { state: 'empty' };
    const { data: run, error: runError } = await db.from('engineering_index_runs')
      .select('id, branch, commit_sha, mode, activated_at, file_count, symbol_count, relation_count, document_count, chunk_count, excluded_count')
      .eq('id', repo.active_run_id).eq('status', 'active').maybeSingle();
    if (runError) return { state: 'unavailable' };
    if (!run) return { state: 'empty' };
    return {
      state: 'ready',
      run: {
        repositoryId: repo.id, githubOwner: repo.github_owner, githubRepo: repo.github_repo, defaultBranch: repo.default_branch,
        runId: run.id, branch: run.branch, commitSha: run.commit_sha, mode: run.mode, activatedAt: run.activated_at,
        counts: {
          files: run.file_count, symbols: run.symbol_count, relations: run.relation_count,
          documents: run.document_count, chunks: run.chunk_count, excluded: run.excluded_count,
        },
      },
    };
  } catch {
    return { state: 'unavailable' };
  }
}
