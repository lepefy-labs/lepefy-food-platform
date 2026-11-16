'use client';

import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconCreditCard,
  IconDots,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import type { PaymentModule, TenantPaymentMethod } from '@lepefy/types';
import Button from '../../_components/ui/Button';
import Menu, { MenuButton } from '../../_components/ui/Menu';
import { useConfirm } from '../../_components/ui/ConfirmDialog';
import { useAdminToast } from '../../_components/ui/Toaster';
import { cn } from '@/lib/utils/cn';
import {
  PAYMENT_MODULES,
  SINGLE_INSTANCE_TYPES,
  draftFromMethod,
  draftToBody,
  moveItem,
  paymentMethodName,
  paymentMethodSummary,
  paymentTypeLabel,
  type PaymentMethodDraft,
} from '@/lib/payments/paymentMethodForm';
import { effectiveModules, isVisibleNowhere, paymentMethodAvailability } from '@/lib/payments/paymentMethodAvailability';
import { ApplePayDomainStatus } from './ApplePayDomainStatus';
import { PaymentMethodsMatrix } from './PaymentMethodsMatrix';
import { PaymentMethodsPreview } from './PaymentMethodsPreview';
import { PaymentModuleChip } from './PaymentModuleChip';
import { SettingsIconTile } from './_components/SettingsUi';
import { PaymentMethodEditor, type PaymentMethodEditorTarget } from './PaymentMethodEditor';
import { PaymentMethodIcon } from './PaymentMethodIcon';

interface PaymentMethodsSectionProps {
  initialMethods: TenantPaymentMethod[];
}

const MODULE_SHORT: Record<PaymentModule, string> = { shop: 'Boutique', card: '/card', event: 'Événements', rental: 'Location' };

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: unknown };
    return typeof body.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** Server-side `cleanExtra` drops empty strings: mirror it in local state. */
function applyBody(m: TenantPaymentMethod, body: ReturnType<typeof draftToBody>): TenantPaymentMethod {
  const extra = body.extra
    ? Object.fromEntries(Object.entries(body.extra).filter(([, v]) => v.trim() !== ''))
    : null;
  return { ...m, ...body, extra: extra && Object.keys(extra).length ? extra : null };
}

export function PaymentMethodsSection({ initialMethods }: PaymentMethodsSectionProps) {
  const [methods, setMethods] = useState<TenantPaymentMethod[]>(initialMethods);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<PaymentMethodEditorTarget | null>(null);
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const gripPressed = useRef(false);
  const methodsRef = useRef(methods);
  methodsRef.current = methods;
  // Order writes are chained so the last move always lands last.
  const orderChain = useRef<Promise<unknown>>(Promise.resolve());
  const toast = useAdminToast();
  const [ask, confirmDialog] = useConfirm();

  // ---------- Order ----------
  const saveOrder = useCallback((next: TenantPaymentMethod[], previous: TenantPaymentMethod[], movedId: string, undoable = true) => {
    const moved = next.find((m) => m.id === movedId);
    const movedName = moved ? paymentMethodName(moved) : 'Moyen de paiement';
    const position = next.findIndex((m) => m.id === movedId) + 1;
    setMethods(next);
    orderChain.current = orderChain.current.then(async () => {
      const res = await fetch('/api/admin/payment-methods/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((m) => m.id) }),
      }).catch(() => null);
      if (!res?.ok) {
        setMethods(previous);
        toast.error('L’ordre n’a pas été enregistré', { description: res ? await readError(res, 'Réessayez.') : 'Connexion impossible. Réessayez.' });
        return;
      }
      toast.success(`Ordre enregistré : ${movedName} en position ${position}`, undoable
        ? { action: { label: 'Annuler', onClick: () => saveOrder(previous, next, movedId, false) } }
        : undefined);
    });
  }, [toast]);

  function moveBy(id: string, delta: number, focusGrip = false) {
    const current = methodsRef.current;
    const from = current.findIndex((m) => m.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    const next = moveItem(current, from, to);
    saveOrder(next, current, id);
    if (focusGrip) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-grip="${id}"]`)?.focus());
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

  function onDrop(event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    const current = methodsRef.current;
    if (!dragId || !dropTarget) { endDrag(); return; }
    const from = current.findIndex((m) => m.id === dragId);
    const without = current.filter((m) => m.id !== dragId);
    const targetIndex = without.findIndex((m) => m.id === dropTarget.id) + (dropTarget.after ? 1 : 0);
    const next = [...without.slice(0, targetIndex), current[from]!, ...without.slice(targetIndex)];
    endDrag();
    if (next.every((m, i) => m.id === current[i]?.id)) return;
    saveOrder(next, current, dragId);
  }

  function endDrag() {
    setDragId(null);
    setDropTarget(null);
    gripPressed.current = false;
  }

  // ---------- Active switch ----------
  async function setActive(id: string, active: boolean, undoable = true) {
    const method = methodsRef.current.find((m) => m.id === id);
    if (!method) return;
    setBusyId(id);
    setMethods((list) => list.map((m) => (m.id === id ? { ...m, active } : m)));
    const res = await fetch(`/api/admin/payment-methods/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      setMethods((list) => list.map((m) => (m.id === id ? { ...m, active: !active } : m)));
      toast.error(`${paymentMethodName(method)} n’a pas été ${active ? 'activé' : 'désactivé'}`, { description: res ? await readError(res, 'Réessayez.') : 'Connexion impossible. Réessayez.' });
      return;
    }
    toast.success(`${paymentMethodName(method)} ${active ? 'activé' : 'désactivé'}`, undoable
      ? { description: active ? 'Proposé de nouveau aux clients.' : 'Il n’est plus proposé aux clients.', action: { label: 'Annuler', onClick: () => { void setActive(id, !active, false); } } }
      : undefined);
  }

  // ---------- Services (matrix) ----------
  async function setModules(id: string, modules: PaymentModule[], changed: PaymentModule, undoable = true) {
    const method = methodsRef.current.find((m) => m.id === id);
    if (!method) return;
    const previous = method.enabled_modules;
    const added = modules.includes(changed);
    const serviceLabel = PAYMENT_MODULES.find((m) => m.value === changed)?.label ?? changed;
    setBusyId(id);
    setMethods((list) => list.map((m) => (m.id === id ? { ...m, enabled_modules: modules } : m)));
    const res = await fetch(`/api/admin/payment-methods/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled_modules: modules }),
    }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      setMethods((list) => list.map((m) => (m.id === id ? { ...m, enabled_modules: previous } : m)));
      toast.error(`${paymentMethodName(method)} n’a pas été modifié`, { description: res ? await readError(res, 'Réessayez.') : 'Connexion impossible. Réessayez.' });
      return;
    }
    toast.success(`${paymentMethodName(method)} ${added ? 'ajouté à' : 'retiré de'} ${serviceLabel}`, undoable
      ? { action: { label: 'Annuler', onClick: () => { void setModules(id, previous, changed, false); } } }
      : undefined);
  }

  function toggleModule(method: TenantPaymentMethod, module: PaymentModule) {
    const on = method.enabled_modules.includes(module);
    const next = on
      ? method.enabled_modules.filter((m) => m !== module)
      : PAYMENT_MODULES.map((m) => m.value).filter((m) => m === module || method.enabled_modules.includes(m));
    // DB constraint: never an empty list. Removing the last service = deactivating.
    if (next.length === 0) {
      toast.error('Au moins un service est nécessaire', { description: `Pour ne plus proposer ${paymentMethodName(method)}, désactivez-le dans la liste.` });
      return;
    }
    void setModules(method.id, next, module);
  }

  // ---------- Create / edit / duplicate / delete ----------
  async function saveDraft(draft: PaymentMethodDraft): Promise<string | null> {
    const body = draftToBody(draft);
    if (editor?.mode === 'edit') {
      const id = editor.method.id;
      const res = await fetch(`/api/admin/payment-methods/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res?.ok) return res ? readError(res, 'La modification n’a pas pu être enregistrée.') : 'Connexion impossible. Réessayez.';
      setMethods((list) => list.map((m) => (m.id === id ? applyBody(m, body) : m)));
      setEditor(null);
      toast.success('Modifications enregistrées', { description: paymentMethodName({ method: body.method, label: body.label }) });
      return null;
    }
    const created = await create({ ...body, sort_order: nextSortOrder() });
    if (typeof created === 'string') return created;
    setEditor(null);
    toast.success(`${paymentMethodName(created)} ajouté`, { description: 'Placé en fin de liste : glissez-le pour changer sa position.' });
    return null;
  }

  function nextSortOrder(): number {
    return methodsRef.current.reduce((max, m) => Math.max(max, m.sort_order), -1) + 1;
  }

  async function create(body: ReturnType<typeof draftToBody> & { sort_order: number }): Promise<TenantPaymentMethod | string> {
    const res = await fetch('/api/admin/payment-methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) return res ? readError(res, 'Le moyen de paiement n’a pas pu être ajouté.') : 'Connexion impossible. Réessayez.';
    const created = await res.json() as TenantPaymentMethod;
    setMethods((list) => [...list, created]);
    return created;
  }

  async function duplicate(method: TenantPaymentMethod) {
    setBusyId(method.id);
    const body = draftToBody({ ...draftFromMethod(method), label: `${paymentMethodName(method)} (copie)`.slice(0, 60), active: false });
    const created = await create({ ...body, sort_order: nextSortOrder() });
    setBusyId(null);
    if (typeof created === 'string') { toast.error('La copie n’a pas pu être créée', { description: created }); return; }
    toast.success(`${paymentMethodName(created)} créé`, { description: 'Désactivé et placé en fin de liste : vérifiez-le avant de l’activer.' });
  }

  async function remove(method: TenantPaymentMethod) {
    const where = method.enabled_modules.map((m) => MODULE_SHORT[m]).join(', ');
    const confirmed = await ask({
      title: `Supprimer « ${paymentMethodName(method)} » ?`,
      description: (
        <>
          {method.active && where ? <>Il ne sera plus proposé sur : {where}. </> : null}
          Les commandes déjà payées ne changent pas. Cette suppression est définitive : pour le retirer temporairement, désactivez-le plutôt.
        </>
      ),
      confirmLabel: 'Supprimer',
      cancelLabel: 'Garder',
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(method.id);
    const res = await fetch(`/api/admin/payment-methods/${method.id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    if (!res?.ok) {
      toast.error(`${paymentMethodName(method)} n’a pas été supprimé`, { description: res ? await readError(res, 'Réessayez.') : 'Connexion impossible. Réessayez.' });
      return;
    }
    setMethods((list) => list.filter((m) => m.id !== method.id));
    toast.success(`${paymentMethodName(method)} supprimé`);
  }

  const activeCount = methods.filter((m) => m.active).length;
  const nowhereCount = methods.filter(isVisibleNowhere).length;

  return (
    <section id="moyens-de-paiement" aria-labelledby="moyens-de-paiement-title" className="scroll-mt-24 overflow-hidden rounded-2xl border border-a-border bg-a-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-a-border px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <SettingsIconTile icon={IconCreditCard} accent="orange" />
          <div className="min-w-0">
            <h2 id="moyens-de-paiement-title" className="text-base font-semibold text-a-text">Moyens de paiement</h2>
            <p className="mt-1 text-sm leading-6 text-a-text-3">
              L’ordre de la liste est l’ordre vu par le client.{' '}
              <span className="tabular-nums">{activeCount} actif{activeCount > 1 ? 's' : ''} sur {methods.length}.</span>
            </p>
          </div>
        </div>
        <Button onClick={() => setEditor({ mode: 'create' })}>
          <IconPlus size={16} stroke={1.8} aria-hidden="true" /> Ajouter un moyen
        </Button>
      </header>

      {methods.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-a-border px-4 py-2.5 sm:px-6">
          <div role="group" aria-label="Affichage" className="inline-flex rounded-xl border border-a-border bg-a-hover p-0.5">
            {([['list', 'Moyens de paiement'], ['matrix', 'Où ils apparaissent']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={cn(
                  'min-h-9 rounded-[10px] px-3 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
                  view === key ? 'bg-a-surface font-semibold text-a-text shadow-sm' : 'text-a-text-2 hover:text-a-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {nowhereCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-tone-warning-fg">
              <IconAlertTriangle size={14} aria-hidden="true" />
              {nowhereCount === 1 ? '1 moyen actif n’est visible nulle part' : `${nowhereCount} moyens actifs ne sont visibles nulle part`}
            </span>
          )}
        </div>
      )}

      <div className="p-2 sm:p-3">
        {methods.some((m) => m.method === 'apple_pay' && m.active) && <div className="p-2"><ApplePayDomainStatus /></div>}

        {methods.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-a-text">Aucun moyen de paiement configuré</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-a-text-3">Ajoutez PayPal, un virement ou un autre moyen pour le proposer à vos clients.</p>
            <Button className="mt-4" onClick={() => setEditor({ mode: 'create' })}>
              <IconPlus size={16} stroke={1.8} aria-hidden="true" /> Ajouter un moyen
            </Button>
          </div>
        ) : view === 'matrix' ? (
          <PaymentMethodsMatrix methods={methods} busyId={busyId} onToggle={toggleModule} />
        ) : (
          <ul className="grid gap-1" aria-label="Moyens de paiement, dans l’ordre affiché aux clients">
            {methods.map((method, index) => {
              const name = paymentMethodName(method);
              const busy = busyId === method.id;
              const indicator = dropTarget?.id === method.id ? (dropTarget.after ? 'after' : 'before') : null;
              return (
                <li
                  key={method.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, method.id)}
                  onDragOver={(e) => onDragOver(e, method.id)}
                  onDrop={onDrop}
                  onDragEnd={endDrag}
                  className={cn(
                    'relative grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border border-transparent py-2.5 pl-1 pr-2 transition sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto]',
                    'hover:border-a-border hover:bg-a-surface-2',
                    dragId === method.id && 'opacity-40',
                    indicator === 'before' && 'before:absolute before:inset-x-2 before:-top-[3px] before:h-0.5 before:rounded before:bg-a-brand',
                    indicator === 'after' && 'after:absolute after:inset-x-2 after:-bottom-[3px] after:h-0.5 after:rounded after:bg-a-brand',
                  )}
                >
                  <button
                    type="button"
                    data-grip={method.id}
                    onPointerDown={() => { gripPressed.current = true; }}
                    onPointerUp={() => { gripPressed.current = false; }}
                    onKeyDown={(e) => onGripKey(e, method.id)}
                    aria-label={`Déplacer ${name}, position ${index + 1} sur ${methods.length}. Flèches haut et bas pour déplacer.`}
                    title="Glisser pour déplacer (ou flèches haut et bas)"
                    className="flex h-10 w-7 cursor-grab items-center justify-center rounded-lg text-a-text-3 hover:bg-a-hover hover:text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus active:cursor-grabbing"
                  >
                    <IconGripVertical size={18} stroke={1.6} aria-hidden="true" />
                  </button>

                  <PaymentMethodIcon method={method.method} className={cn(!method.active && 'opacity-50')} />

                  <button
                    type="button"
                    onClick={() => setEditor({ mode: 'edit', method })}
                    className={cn('grid min-w-0 gap-1 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus', !method.active && 'opacity-60')}
                    aria-label={`Modifier ${name}`}
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold text-a-text">{name}</span>
                      {method.label?.trim() && method.label.trim() !== paymentTypeLabel(method.method) && (
                        <span className="text-xs text-a-text-3">{paymentTypeLabel(method.method)}</span>
                      )}
                    </span>
                    <span className="break-all text-xs tabular-nums text-a-text-2">{paymentMethodSummary(method)}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1.5" aria-label="Services où ce moyen est proposé">
                      {!method.active && <span className="inline-flex h-6 items-center rounded-md border border-a-border px-2 text-[11px] font-semibold text-a-text-3">Désactivé</span>}
                      {method.active && isVisibleNowhere(method) && (
                        <span
                          title={paymentMethodAvailability(method, method.enabled_modules[0] ?? 'shop').detail}
                          className="inline-flex h-6 items-center gap-1 rounded-md border border-tone-warning-border bg-tone-warning-bg px-2 text-[11px] font-semibold text-tone-warning-fg"
                        >
                          <IconAlertTriangle size={12} aria-hidden="true" /> Visible nulle part
                        </span>
                      )}
                      {method.active && effectiveModules(method).map((mod) => <PaymentModuleChip key={mod} module={mod} />)}
                    </span>
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={method.active}
                    aria-label={`${name} ${method.active ? 'actif' : 'inactif'}`}
                    disabled={busy}
                    onClick={() => { void setActive(method.id, !method.active); }}
                    className="col-start-3 row-start-2 inline-flex min-h-10 items-center gap-2 justify-self-start rounded-lg px-1 text-xs font-medium text-a-text-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus disabled:opacity-60 sm:col-start-4 sm:row-start-1 sm:min-w-[6.5rem]"
                  >
                    <span aria-hidden="true" className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', method.active ? 'bg-a-brand' : 'bg-a-border-strong')}>
                      <span className={cn('inline-block h-5 w-5 rounded-full bg-a-surface shadow transition-transform', method.active ? 'translate-x-5' : 'translate-x-0.5')} />
                    </span>
                    {method.active ? 'Actif' : 'Inactif'}
                  </button>

                  <div className="col-start-4 row-start-1 sm:col-start-5">
                    <Menu
                      label={`Actions pour ${name}`}
                      trigger={<IconDots size={18} aria-hidden="true" />}
                      triggerClassName="flex h-9 w-9 items-center justify-center rounded-lg text-a-text-2 hover:bg-a-hover hover:text-a-text"
                    >
                      <MenuButton onSelect={() => setEditor({ mode: 'edit', method })}><IconPencil size={16} aria-hidden="true" /> Modifier</MenuButton>
                      {!SINGLE_INSTANCE_TYPES.has(method.method) && (
                        <MenuButton onSelect={() => { void duplicate(method); }}><IconCopy size={16} aria-hidden="true" /> Dupliquer</MenuButton>
                      )}
                      {index > 0 && <MenuButton onSelect={() => moveBy(method.id, -1)}><IconArrowUp size={16} aria-hidden="true" /> Monter</MenuButton>}
                      {index < methods.length - 1 && <MenuButton onSelect={() => moveBy(method.id, 1)}><IconArrowDown size={16} aria-hidden="true" /> Descendre</MenuButton>}
                      <div role="separator" className="my-1 border-t border-a-border" />
                      <MenuButton tone="danger" onSelect={() => { void remove(method); }}><IconTrash size={16} aria-hidden="true" /> Supprimer</MenuButton>
                    </Menu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {methods.length > 0 && <PaymentMethodsPreview methods={methods} />}

      {methods.length > 1 && view === 'list' && (
        <p className="border-t border-a-border px-4 py-3 text-xs leading-5 text-a-text-3 sm:px-6">
          Glissez une ligne par sa poignée, ou utilisez les flèches haut et bas sur la poignée, pour changer l’ordre. Tout est enregistré immédiatement.
        </p>
      )}

      <PaymentMethodEditor
        target={editor}
        existingTypes={methods.map((m) => m.method)}
        onClose={() => setEditor(null)}
        onSave={saveDraft}
      />
      {confirmDialog}
    </section>
  );
}
