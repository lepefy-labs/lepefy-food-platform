'use client';

import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { IconArrowDown, IconArrowUp, IconDots, IconExternalLink, IconGripVertical, IconPencil, IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react';
import { SOCIAL_PLATFORM_REGISTRY, type SocialPlatform, type TenantSocialLink } from '@lepefy/types';
import Button from '../../_components/ui/Button';
import Menu, { MenuButton, MenuLink } from '../../_components/ui/Menu';
import { useConfirm } from '../../_components/ui/ConfirmDialog';
import { useAdminToast } from '../../_components/ui/Toaster';
import { cn } from '@/lib/utils/cn';
import { moveItem } from '@/lib/admin/listOrder';
import { normalizeSocialUrl, socialDisplayName } from '@/lib/social/socialLinkUrl';
import { SettingsPanel } from './_components/SettingsUi';
import { SocialLinkEditor, SOCIAL_PLATFORMS, type SocialLinkEditorTarget } from './SocialLinkEditor';
import { SocialPlatformBadge } from './SocialPlatformBadge';

const label = (p: SocialPlatform) => SOCIAL_PLATFORM_REGISTRY[p].label;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: unknown };
    return typeof body.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** The stored link still carries tracking parameters (saved before links were cleaned). */
function needsCleaning(link: TenantSocialLink): boolean {
  const r = normalizeSocialUrl(link.platform, link.url);
  return r.ok && r.url !== link.url;
}

export function SocialLinksSection({ initialLinks }: { initialLinks: TenantSocialLink[] }) {
  const [links, setLinks] = useState<TenantSocialLink[]>(initialLinks);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<SocialLinkEditorTarget | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const gripPressed = useRef(false);
  const linksRef = useRef(links);
  linksRef.current = links;
  const orderChain = useRef<Promise<unknown>>(Promise.resolve());
  const toast = useAdminToast();
  const [ask, confirmDialog] = useConfirm();
  const usedPlatforms = links.map((l) => l.platform);

  // ---------- Order ----------
  const saveOrder = useCallback((next: TenantSocialLink[], previous: TenantSocialLink[], movedId: string, undoable = true) => {
    const moved = next.find((l) => l.id === movedId);
    const position = next.findIndex((l) => l.id === movedId) + 1;
    setLinks(next);
    orderChain.current = orderChain.current.then(async () => {
      const res = await fetch('/api/admin/social-links/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((l) => l.id) }),
      }).catch(() => null);
      if (!res?.ok) {
        setLinks(previous);
        toast.error('L’ordre n’a pas été enregistré', { description: res ? await readError(res, 'Réessayez.') : 'Connexion impossible. Réessayez.' });
        return;
      }
      toast.success(`Ordre enregistré : ${moved ? label(moved.platform) : 'réseau'} en position ${position}`, undoable
        ? { action: { label: 'Annuler', onClick: () => saveOrder(previous, next, movedId, false) } }
        : undefined);
    });
  }, [toast]);

  function moveBy(id: string, delta: number, focusGrip = false) {
    const current = linksRef.current;
    const from = current.findIndex((l) => l.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    saveOrder(moveItem(current, from, to), current, id);
    if (focusGrip) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-social-grip="${id}"]`)?.focus());
  }

  function onGripKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveBy(id, event.key === 'ArrowUp' ? -1 : 1, true);
    }
  }

  function onDragStart(event: DragEvent<HTMLLIElement>, id: string) {
    if (!gripPressed.current) { event.preventDefault(); return; }
    setDragId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  }

  function onDragOver(event: DragEvent<HTMLLIElement>, id: string) {
    if (!dragId) return;
    event.preventDefault();
    if (id === dragId) { setDropTarget(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    setDropTarget((t) => (t?.id === id && t.after === after ? t : { id, after }));
  }

  function endDrag() {
    setDragId(null);
    setDropTarget(null);
    gripPressed.current = false;
  }

  function onDrop(event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    const current = linksRef.current;
    const moving = dragId;
    if (!moving || !dropTarget) { endDrag(); return; }
    const item = current.find((l) => l.id === moving)!;
    const without = current.filter((l) => l.id !== moving);
    const at = without.findIndex((l) => l.id === dropTarget.id) + (dropTarget.after ? 1 : 0);
    const next = [...without.slice(0, at), item, ...without.slice(at)];
    endDrag();
    if (next.every((l, i) => l.id === current[i]?.id)) return;
    saveOrder(next, current, moving);
  }

  // ---------- Writes ----------
  async function patch(id: string, body: Record<string, unknown>): Promise<string | null> {
    const res = await fetch(`/api/admin/social-links/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) return res ? readError(res, 'La modification n’a pas pu être enregistrée.') : 'Connexion impossible. Réessayez.';
    return null;
  }

  async function setActive(id: string, active: boolean, undoable = true) {
    const link = linksRef.current.find((l) => l.id === id);
    if (!link) return;
    setBusyId(id);
    setLinks((list) => list.map((l) => (l.id === id ? { ...l, active } : l)));
    const failure = await patch(id, { active });
    setBusyId(null);
    if (failure) {
      setLinks((list) => list.map((l) => (l.id === id ? { ...l, active: !active } : l)));
      toast.error(`${label(link.platform)} n’a pas été ${active ? 'affiché' : 'masqué'}`, { description: failure });
      return;
    }
    toast.success(`${label(link.platform)} ${active ? 'affiché' : 'masqué'}`, undoable
      ? { description: active ? 'Visible de nouveau par vos clients.' : 'Il n’apparaît plus à vos clients.', action: { label: 'Annuler', onClick: () => { void setActive(id, !active, false); } } }
      : undefined);
  }

  async function save(platform: SocialPlatform, url: string): Promise<string | null> {
    if (editor?.mode === 'edit') {
      const id = editor.link.id;
      const failure = await patch(id, { url });
      if (failure) return failure;
      setLinks((list) => list.map((l) => (l.id === id ? { ...l, url } : l)));
      setEditor(null);
      toast.success(`Lien ${label(platform)} enregistré`);
      return null;
    }
    const sortOrder = linksRef.current.reduce((max, l) => Math.max(max, l.sort_order), -1) + 1;
    const res = await fetch('/api/admin/social-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, url, sort_order: sortOrder, active: true }),
    }).catch(() => null);
    if (!res?.ok) return res ? readError(res, 'Le réseau social n’a pas pu être ajouté.') : 'Connexion impossible. Réessayez.';
    const created = await res.json() as TenantSocialLink;
    setLinks((list) => [...list, created]);
    setEditor(null);
    toast.success(`${label(platform)} ajouté`, { description: 'Placé en dernier : glissez-le pour changer sa position.' });
    return null;
  }

  async function remove(link: TenantSocialLink) {
    const ok = await ask({
      title: `Supprimer ${label(link.platform)} ?`,
      description: 'Le lien disparaîtra de la carte digitale, de la boutique et des événements. Pour le cacher un moment, masquez-le plutôt.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Garder',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(link.id);
    const res = await fetch(`/api/admin/social-links/${link.id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      toast.error(`${label(link.platform)} n’a pas été supprimé`, { description: res ? await readError(res, 'Réessayez.') : 'Connexion impossible. Réessayez.' });
      return;
    }
    setLinks((list) => list.filter((l) => l.id !== link.id));
    toast.success(`${label(link.platform)} supprimé`);
  }

  const canAdd = usedPlatforms.length < SOCIAL_PLATFORMS.length;

  return (
    <SettingsPanel
      id="reseaux-sociaux"
      title="Réseaux sociaux"
      description="Affichés dans cet ordre sur la carte digitale (/card) et son affiche, dans le pied de page et le menu de la boutique, et dans le menu des événements."
      aside={canAdd ? <Button onClick={() => setEditor({ mode: 'create' })}><IconPlus size={16} stroke={1.8} aria-hidden="true" /> Ajouter un réseau</Button> : undefined}
    >
      {links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-a-border px-4 py-8 text-center">
          <p className="text-sm font-semibold text-a-text">Aucun réseau social</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-a-text-3">Ajoutez Instagram, Facebook ou TikTok pour que vos clients vous suivent depuis la carte et la boutique.</p>
        </div>
      ) : (
        <ul className="-mx-2 grid gap-1" aria-label="Réseaux sociaux, dans l’ordre affiché aux clients">
          {links.map((link, index) => {
            const name = label(link.platform);
            const dirtyUrl = needsCleaning(link);
            const indicator = dropTarget?.id === link.id ? (dropTarget.after ? 'after' : 'before') : null;
            return (
              <li
                key={link.id}
                draggable
                onDragStart={(e) => onDragStart(e, link.id)}
                onDragOver={(e) => onDragOver(e, link.id)}
                onDrop={onDrop}
                onDragEnd={endDrag}
                className={cn(
                  'relative grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-transparent py-2.5 pl-1 pr-2 transition sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]',
                  'hover:border-a-border hover:bg-a-surface-2',
                  dragId === link.id && 'opacity-40',
                  indicator === 'before' && 'before:absolute before:inset-x-2 before:-top-[3px] before:h-0.5 before:rounded before:bg-a-brand',
                  indicator === 'after' && 'after:absolute after:inset-x-2 after:-bottom-[3px] after:h-0.5 after:rounded after:bg-a-brand',
                )}
              >
                <button
                  type="button"
                  data-social-grip={link.id}
                  onPointerDown={() => { gripPressed.current = true; }}
                  onPointerUp={() => { gripPressed.current = false; }}
                  onKeyDown={(e) => onGripKey(e, link.id)}
                  aria-label={`Déplacer ${name}, position ${index + 1} sur ${links.length}. Flèches haut et bas pour déplacer.`}
                  title="Glisser pour déplacer (ou flèches haut et bas)"
                  className="flex h-10 w-7 cursor-grab items-center justify-center rounded-lg text-a-text-3 hover:bg-a-hover hover:text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus active:cursor-grabbing"
                >
                  <IconGripVertical size={18} stroke={1.6} aria-hidden="true" />
                </button>

                <SocialPlatformBadge platform={link.platform} className={cn(!link.active && 'opacity-40 grayscale')} />

                <button
                  type="button"
                  onClick={() => setEditor({ mode: 'edit', link })}
                  aria-label={`Modifier ${name}`}
                  className={cn('grid min-w-0 gap-0.5 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus', !link.active && 'opacity-60')}
                >
                  <span className="text-sm font-semibold text-a-text">{name}</span>
                  <span className="break-all text-xs text-a-text-2">{socialDisplayName(link.platform, link.url)}</span>
                  {!link.active && <span className="text-[11px] font-semibold text-a-text-3">Masqué</span>}
                  {dirtyUrl && (
                    <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-tone-warning-border bg-tone-warning-bg px-2 py-0.5 text-[11px] font-semibold text-tone-warning-fg">
                      <IconSparkles size={12} aria-hidden="true" /> Lien avec paramètres de suivi : touchez pour le nettoyer
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={link.active}
                  aria-label={`${name} ${link.active ? 'affiché' : 'masqué'}`}
                  disabled={busyId === link.id}
                  onClick={() => { void setActive(link.id, !link.active); }}
                  className="col-start-3 row-start-2 inline-flex min-h-10 items-center gap-2 justify-self-start rounded-lg px-1 text-xs font-medium text-a-text-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus disabled:opacity-60 sm:col-start-4 sm:row-start-1 sm:min-w-[6.5rem]"
                >
                  <span aria-hidden="true" className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', link.active ? 'bg-a-brand' : 'bg-a-border-strong')}>
                    <span className={cn('inline-block h-5 w-5 rounded-full bg-a-surface shadow transition-transform', link.active ? 'translate-x-5' : 'translate-x-0.5')} />
                  </span>
                  {link.active ? 'Affiché' : 'Masqué'}
                </button>

                <div className="col-start-4 row-start-1 sm:col-start-5">
                  <Menu
                    label={`Actions pour ${name}`}
                    trigger={<IconDots size={18} aria-hidden="true" />}
                    triggerClassName="flex h-9 w-9 items-center justify-center rounded-lg text-a-text-2 hover:bg-a-hover hover:text-a-text"
                  >
                    <MenuButton onSelect={() => setEditor({ mode: 'edit', link })}><IconPencil size={16} aria-hidden="true" /> Modifier le lien</MenuButton>
                    <MenuLink href={link.url} newTab><IconExternalLink size={16} aria-hidden="true" /> Ouvrir la page (nouvel onglet)</MenuLink>
                    {index > 0 && <MenuButton onSelect={() => moveBy(link.id, -1)}><IconArrowUp size={16} aria-hidden="true" /> Monter</MenuButton>}
                    {index < links.length - 1 && <MenuButton onSelect={() => moveBy(link.id, 1)}><IconArrowDown size={16} aria-hidden="true" /> Descendre</MenuButton>}
                    <div role="separator" className="my-1 border-t border-a-border" />
                    <MenuButton tone="danger" onSelect={() => { void remove(link); }}><IconTrash size={16} aria-hidden="true" /> Supprimer</MenuButton>
                  </Menu>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {links.length > 1 && (
        <p className="mt-4 border-t border-a-border pt-3 text-xs leading-5 text-a-text-3">
          Glissez une ligne par sa poignée, ou utilisez les flèches haut et bas sur la poignée, pour changer l’ordre. Tout est enregistré immédiatement.
        </p>
      )}

      <SocialLinkEditor target={editor} usedPlatforms={usedPlatforms} onClose={() => setEditor(null)} onSave={save} />
      {confirmDialog}
    </SettingsPanel>
  );
}
