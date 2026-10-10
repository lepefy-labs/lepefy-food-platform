import { STATUS_LABELS } from '@/lib/platform/prospects/config';
export const card = 'rounded-2xl border border-a-border bg-a-surface p-4';
export const field = 'min-h-11 w-full rounded-lg border border-a-border-strong bg-a-surface px-3 py-2 text-sm text-a-text focus-visible:outline-a-brand';
export const button = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-a-brand px-4 py-2 text-sm font-semibold text-a-on-brand hover:bg-a-brand focus-visible:outline-a-brand disabled:opacity-50';
export const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-a-border-strong px-3 py-2 text-sm font-medium hover:bg-a-surface-2 focus-visible:outline-a-brand disabled:opacity-50';
export function Badge({value}:{value:string}) {
  return <span className={'inline-block rounded-full px-2 py-1 text-xs font-medium '+(
    ['priority','qualified','completed','won'].includes(value) ? 'bg-tone-success-bg text-tone-success-fg' :
    ['failed','blocked','lost'].includes(value) ? 'bg-tone-danger-bg text-tone-danger-fg' : 'bg-a-brand-soft text-a-brand-fg')}>{STATUS_LABELS[value] ?? value}</span>;
}
export const dateLabel = (s:string | null | undefined) => s ? new Date(s).toLocaleString('fr-FR') : '—';
export function ExternalLink({href,children}:{href?:string | null;children:React.ReactNode}) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>—</span>;
  return <a className="break-all text-a-brand-fg underline" href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}
export async function api<T>(path:string,init?:RequestInit):Promise<T> {
  let response:Response;
  try { response = await fetch(path,{cache:'no-store',...init}); }
  catch { throw new Error('Connexion impossible. Vérifiez le réseau et réessayez.'); }
  // A platform timeout (504) or proxy page is not JSON: report the status instead of crashing.
  const body = await response.json().catch(() => null) as ({error?:string} & T) | null;
  if (!response.ok) throw new Error(body?.error ?? (response.status === 504 ? 'Le serveur a mis trop de temps à répondre. Réessayez.' : 'Opération indisponible (HTTP '+response.status+').'));
  if (body === null) throw new Error('Réponse illisible du serveur. Réessayez.');
  return body as T;
}
