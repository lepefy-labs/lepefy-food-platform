'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { IconArrowLeft, IconBook2, IconLifebuoy, IconLink, IconSearch, IconThumbDown, IconThumbUp } from '@tabler/icons-react';
import type { HelpArticleSummary } from '@/lib/helpCenter/domain';
import { helpModuleLabel } from '@/lib/helpCenter/domain';
import { cleanSearchQuery, isSearchable } from '@/lib/helpCenter/rules';
import { cn } from '@/lib/utils/cn';
import { Drawer } from '../ui/Dialog';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import InlineAlert from '../ui/InlineAlert';
import { Skeleton } from '../ui/States';
import { Input } from '../ui/Form';
import { useAdminToast } from '../ui/Toaster';
import HelpArticleBody, { RelatedLinks } from './HelpArticleBody';
import {
  fetchHelpArticle, fetchHelpContext, fetchHelpSearch, helpArticleHref, sendHelpEvent,
  type HelpArticlePayload, type HelpContextPayload,
} from './helpClient';

type Tab = 'learn' | 'contact';

/**
 * Contextual help panel. Two paths: « Comprendre et apprendre » (guides for the
 * current page, search, a guide) and « Contacter Lepefy » (only when Assistance
 * is available to this admin). Everything is read on demand and authorised on
 * the server; errors never block the admin page behind the panel.
 */
export default function HelpDrawer({ open, onClose, pathname, initialSlug, supportAvailable, onContactSupport }: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  initialSlug: string | null;
  supportAvailable: boolean;
  onContactSupport: (helpArticle?: string) => void;
}) {
  const toast = useAdminToast();
  const searchId = useId();
  const [tab, setTab] = useState<Tab>('learn');
  const [context, setContext] = useState<HelpContextPayload | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HelpArticleSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [article, setArticle] = useState<HelpArticlePayload | null>(null);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [voted, setVoted] = useState<'helpful' | 'not_helpful' | null>(null);
  const viewed = useRef(new Set<string>());

  // Guides for the page the admin is on.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetchHelpContext(pathname, controller.signal)
      .then((payload) => { setContext(payload); setContextError(null); })
      .catch((error: Error) => { if (error.name !== 'AbortError') setContextError(error.message); });
    return () => controller.abort();
  }, [open, pathname]);

  // Search (debounced, abortable).
  useEffect(() => {
    const clean = cleanSearchQuery(query);
    if (!isSearchable(clean)) { setResults(null); setSearchError(null); setSearching(false); return; }
    setSearching(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchHelpSearch(clean, controller.signal)
        .then((payload) => { setResults(payload.results); setSearchError(null); })
        .catch((error: Error) => { if (error.name !== 'AbortError') setSearchError(error.message); })
        .finally(() => setSearching(false));
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  // A guide.
  useEffect(() => {
    if (!slug) { setArticle(null); setArticleError(null); return; }
    const controller = new AbortController();
    setArticle(null);
    setArticleError(null);
    setVoted(null);
    fetchHelpArticle(slug, controller.signal)
      .then((payload) => {
        setArticle(payload);
        if (!viewed.current.has(slug)) { viewed.current.add(slug); sendHelpEvent(slug, 'view'); }
      })
      .catch((error: Error) => { if (error.name !== 'AbortError') setArticleError(error.message); });
    return () => controller.abort();
  }, [slug]);

  const vote = useCallback((event: 'helpful' | 'not_helpful') => {
    if (!slug || voted) return;
    setVoted(event);
    sendHelpEvent(slug, event);
  }, [slug, voted]);

  const copyLink = useCallback(async () => {
    if (!slug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${helpArticleHref(slug)}`);
      toast.success('Lien copié.');
    } catch {
      toast.error('Impossible de copier le lien.');
    }
  }, [slug, toast]);

  const contact = useCallback(() => {
    if (slug) sendHelpEvent(slug, 'support_opened');
    onContactSupport(slug ?? undefined);
  }, [slug, onContactSupport]);

  const showingSearch = results !== null || searching || searchError !== null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Centre d’aide"
      icon={<IconBook2 size={20} aria-hidden="true" />}
      footer={slug ? undefined : <Link href="/admin/aide" onClick={onClose} className="text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline">Voir toutes les guides</Link>}
    >
      <div className="space-y-4">
        {slug ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSlug(null)}><IconArrowLeft size={16} aria-hidden="true" />Retour</Button>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={copyLink} aria-label="Copier le lien de cette guide"><IconLink size={16} aria-hidden="true" />Copier le lien</Button>
            </div>
            {articleError && <InlineAlert tone="danger" title="Guide indisponible">{articleError}</InlineAlert>}
            {!articleError && !article && <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
            {article && (
              <article className="space-y-4">
                <header className="space-y-1">
                  <h3 className="text-lg font-semibold text-a-text">{article.article.title}</h3>
                  <p className="text-xs text-a-text-3">
                    {helpModuleLabel(article.article.module)}
                    {article.article.updatedAt ? ` · Mis à jour le ${new Date(article.article.updatedAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''}
                  </p>
                  {article.localeFallback && <Badge tone="neutral">Affiché en français : pas encore traduit</Badge>}
                </header>
                <HelpArticleBody blocks={article.article.blocks} />
                <RelatedLinks href={helpArticleHref} items={article.related.map((item) => ({ slug: item.slug, title: item.title }))} />
                <footer className="space-y-3 border-t border-a-border pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-a-text-2">Cette guide vous a aidé ?</span>
                    <Button variant="outline" size="sm" disabled={voted !== null} onClick={() => vote('helpful')}><IconThumbUp size={16} aria-hidden="true" />Utile</Button>
                    <Button variant="outline" size="sm" disabled={voted !== null} onClick={() => vote('not_helpful')}><IconThumbDown size={16} aria-hidden="true" />Pas utile</Button>
                  </div>
                  {voted && <p role="status" className="text-sm text-a-text-2">Merci pour votre retour.</p>}
                  {supportAvailable && (voted === 'not_helpful' || !voted) && (
                    <button type="button" onClick={contact} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
                      <IconLifebuoy size={16} aria-hidden="true" />Besoin de plus d’aide ? Contacter Lepefy
                    </button>
                  )}
                </footer>
              </article>
            )}
          </div>
        ) : (
          <>
            <div role="search" className="space-y-1.5">
              <label htmlFor={searchId} className="sr-only">Rechercher dans l’aide</label>
              <div className="relative">
                <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
                <Input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une guide… (ex. imprimer, promo)" className="pl-9" autoComplete="off" maxLength={80} />
              </div>
            </div>

            {supportAvailable && (
              <div role="tablist" aria-label="Type d’aide" className="grid grid-cols-2 gap-1 rounded-[10px] bg-a-surface-2 p-1">
                {([['learn', 'Comprendre et apprendre'], ['contact', 'Contacter Lepefy']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                    className={cn('min-h-10 rounded-lg px-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
                      tab === key ? 'bg-a-surface text-a-brand-fg shadow-sm' : 'text-a-text-2 hover:text-a-text')}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {tab === 'contact' && supportAvailable ? (
              <div role="tabpanel" className="space-y-3">
                <p className="text-sm leading-6 text-a-text-2">Un problème, une question ou une idée ? Écrivez à l’équipe Lepefy : la page où vous êtes est jointe automatiquement.</p>
                <Button onClick={() => { onClose(); onContactSupport(); }}><IconLifebuoy size={18} aria-hidden="true" />Écrire à Lepefy</Button>
              </div>
            ) : showingSearch ? (
              <section aria-live="polite" className="space-y-2">
                <h3 className="text-xs font-semibold text-a-text-3">Résultats</h3>
                {searching && <Skeleton className="h-14 w-full" />}
                {searchError && <InlineAlert tone="warning">{searchError}</InlineAlert>}
                {!searching && !searchError && results && results.length === 0 && (
                  <p className="text-sm leading-6 text-a-text-2">Aucune guide ne correspond à « {cleanSearchQuery(query)} ». Essayez un autre mot, ou parcourez toutes les guides.</p>
                )}
                {results && <GuideList items={results} onOpen={setSlug} />}
              </section>
            ) : (
              <>
                {contextError && <InlineAlert tone="warning" title="Aide indisponible pour le moment">{contextError} Vous pouvez continuer à travailler.</InlineAlert>}
                {!contextError && !context && <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>}
                {context && context.primary.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold text-a-text-3">Pour cette page</h3>
                    <GuideList items={context.primary} onOpen={setSlug} />
                  </section>
                )}
                {context && context.fallback && (
                  <p className="text-sm leading-6 text-a-text-2">Aucune guide n’est liée à cette page pour l’instant. Utilisez la recherche ou parcourez toutes les guides.</p>
                )}
                {context && context.related.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold text-a-text-3">Guides liées</h3>
                    <GuideList items={context.related} onOpen={setSlug} />
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

function GuideList({ items, onOpen }: { items: HelpArticleSummary[]; onOpen: (slug: string) => void }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.slug}>
          <button type="button" onClick={() => onOpen(item.slug)}
            className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-[10px] border border-a-border bg-a-surface px-3 py-2 text-left hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
            <span className="text-sm font-semibold text-a-text">{item.title}</span>
            <span className="text-xs text-a-text-3">{helpModuleLabel(item.module)}{item.stepCount > 0 ? ` · ${item.stepCount} étape${item.stepCount > 1 ? 's' : ''}` : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
