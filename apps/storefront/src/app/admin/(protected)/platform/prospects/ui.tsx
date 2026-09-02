import { STATUS_LABELS } from '@/lib/platform/prospects/config';
export const card = 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
export const field = 'min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 focus-visible:outline-violet-600 dark:border-gray-700 dark:bg-gray-900 dark:text-white';
export const button = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-violet-600 disabled:opacity-50';
export const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 focus-visible:outline-violet-600 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50';
export function Badge({value}:{value:string}) {
  return <span className={'inline-block rounded-full px-2 py-1 text-xs font-medium '+(
    ['priority','qualified','completed','won'].includes(value) ? 'bg-emerald-50 text-emerald-800' :
    ['failed','blocked','lost'].includes(value) ? 'bg-red-50 text-red-800' : 'bg-violet-50 text-violet-800')}>{STATUS_LABELS[value] ?? value}</span>;
}
export const dateLabel = (s:string | null | undefined) => s ? new Date(s).toLocaleString('fr-FR') : '—';
export function ExternalLink({href,children}:{href?:string | null;children:React.ReactNode}) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>—</span>;
  return <a className="break-all text-violet-700 underline dark:text-violet-300" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}
export async function api<T>(path:string,init?:RequestInit):Promise<T> {
  const response = await fetch(path,{cache:'no-store',...init});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Opération indisponible.');
  return body as T;
}
