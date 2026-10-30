import type { FileKind, FileLanguage } from '../domain';

export function languageOf(path: string): FileLanguage {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'ts' || ext === 'tsx') return 'typescript';
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'sql') return 'sql';
  if (ext === 'md' || ext === 'mdx') return 'markdown';
  if (ext === 'yml' || ext === 'yaml') return 'yaml';
  if (ext === 'json') return 'json';
  return 'other';
}

export function kindOf(path: string): FileKind {
  const language = languageOf(path);
  if (path.startsWith('.github/workflows/')) return 'ci';
  if (language === 'sql') {
    if (path.startsWith('supabase/migrations/')) return 'migration';
    if (path.startsWith('supabase/tests/')) return 'test';
    return 'sql';
  }
  if (language === 'markdown') return 'doc';
  if (language === 'json' || language === 'yaml' || language === 'other') return 'config';
  if (/(^|\/)tests?\//.test(path) || /\.(spec|test)\.[cm]?[jt]sx?$/.test(path)) return 'test';
  if (/(^|\/)app\/api\/.+\/route\.[jt]s$/.test(path)) return 'api_route';
  if (/(^|\/)app\/.+\/(page|layout)\.[jt]sx?$/.test(path) || /(^|\/)app\/(page|layout)\.[jt]sx?$/.test(path)) return 'page';
  if (/(^|\/)scripts\//.test(path)) return 'script';
  if (/\.config\.[cm]?[jt]s$/.test(path)) return 'config';
  if (path.endsWith('.tsx') && /(^|\/)(components|_components)\//.test(path)) return 'component';
  return 'source';
}

/** Next.js route served by an App Router file, derived from the path (route groups removed). */
export function routeOf(path: string): { route: string; kind: 'api' | 'page' } | null {
  const match = /^apps\/storefront\/src\/app\/(.*)\/?(route\.[jt]s|page\.[jt]sx?)$/.exec(path);
  if (!match) return null;
  const dir = (match[1] ?? '')
    .split('/')
    .filter((segment) => segment && !/^\(.*\)$/.test(segment))
    .join('/');
  return { route: `/${dir}`.replace(/\/+$/, '') || '/', kind: (match[2] ?? '').startsWith('route') ? 'api' : 'page' };
}
