'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { IconBrandWhatsapp, IconBuildingStore, IconExternalLink, IconMail, IconMessageCircleQuestion, IconRefresh } from '@tabler/icons-react';
import { useCartStore } from '@/stores/cartStore';
import type { PortalCta } from '@/lib/orders/portal/portalViewModel';
import type { ReorderProposal } from '@/lib/orders/portal/reorderProposal';
import type { SupportChannel } from '@/lib/orders/portal/supportChannels';

interface Props {
  token: string;
  primary: PortalCta | null;
  secondary: PortalCta[];
  support: SupportChannel[];
}

const primaryCls = 'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-dark)] focus-visible:ring-offset-2 disabled:opacity-60';
const secondaryCls = 'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-dark)] focus-visible:ring-offset-2 disabled:opacity-60';

const SUPPORT_ICON = { whatsapp: IconBrandWhatsapp, email: IconMail, shop: IconBuildingStore } as const;

type ReorderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; added: number; proposal: ReorderProposal }
  | { status: 'error'; message: string };

/**
 * Actions du portail. Le riordino lit une proposition serveur (prix, minimums
 * et stock actuels) puis passe par le panier normal (`addItem` applique encore
 * minimum/pas/stock) ; le checkout revalide tout, y compris les groupes.
 */
export default function PortalActions({ token, primary, secondary, support }: Props) {
  const [reorder, setReorder] = useState<ReorderState>({ status: 'idle' });
  const [supportOpen, setSupportOpen] = useState(false);
  const supportId = useId();
  const resultId = useId();

  async function runReorder() {
    setReorder({ status: 'loading' });
    try {
      const response = await fetch(`/api/order-portal/${encodeURIComponent(token)}/reorder`, { cache: 'no-store', referrerPolicy: 'no-referrer' });
      const body = await response.json().catch(() => null) as (ReorderProposal & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? 'Impossible de préparer votre panier. Réessayez.');
      const addItem = useCartStore.getState().addItem;
      for (const line of body.lines) addItem(line.product, line.quantity);
      setReorder({ status: 'done', added: body.lines.length, proposal: body });
    } catch (error) {
      setReorder({ status: 'error', message: error instanceof Error ? error.message : 'Impossible de préparer votre panier. Réessayez.' });
    }
  }

  function renderCta(cta: PortalCta, className: string) {
    switch (cta.kind) {
      case 'track':
      case 'maps':
        return <a key={cta.kind} href={cta.href} target="_blank" rel="noopener noreferrer" className={className}>{cta.label} <IconExternalLink size={16} aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span></a>;
      case 'reorder':
        return <button key={cta.kind} type="button" onClick={() => void runReorder()} disabled={reorder.status === 'loading'} aria-describedby={reorder.status === 'done' || reorder.status === 'error' ? resultId : undefined} className={className}>
          <IconRefresh size={17} aria-hidden="true" /> {reorder.status === 'loading' ? 'Préparation du panier…' : cta.label}
        </button>;
      case 'review':
        return <form key={cta.kind} method="post" action={`/o/${encodeURIComponent(token)}/avis`}><button type="submit" className={className}>{cta.label}</button></form>;
      case 'support':
        if (support.length === 1) {
          const channel = support[0]!;
          return <a key={cta.kind} href={channel.href} target={channel.kind === 'email' ? undefined : '_blank'} rel="noopener noreferrer" className={className}><IconMessageCircleQuestion size={17} aria-hidden="true" /> {cta.label}</a>;
        }
        return <button key={cta.kind} type="button" aria-expanded={supportOpen} aria-controls={supportId} onClick={() => setSupportOpen((open) => !open)} className={className}>
          <IconMessageCircleQuestion size={17} aria-hidden="true" /> {cta.label}
        </button>;
    }
  }

  if (!primary && secondary.length === 0) return null;
  const proposal = reorder.status === 'done' ? reorder.proposal : null;

  return (
    <div className="mt-5 space-y-2.5">
      {primary && renderCta(primary, primaryCls)}

      {(reorder.status === 'done' || reorder.status === 'error') && (
        <div id={resultId} role="status" className={`rounded-xl p-3 text-sm ${reorder.status === 'error' || reorder.added === 0 ? 'border border-amber-200 bg-amber-50 text-amber-900' : 'border border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          {reorder.status === 'error' ? reorder.message : (
            <>
              <p className="font-semibold">{reorder.added === 0 ? 'Aucun produit n’a pu être ajouté.' : `${reorder.added} produit${reorder.added > 1 ? 's' : ''} ajouté${reorder.added > 1 ? 's' : ''} au panier.`}</p>
              {proposal && proposal.unavailable.length > 0 && (
                <div className="mt-2">
                  <p>{proposal.unavailable.length} produit{proposal.unavailable.length > 1 ? 's ne sont' : ' n’est'} plus disponible{proposal.unavailable.length > 1 ? 's' : ''} :</p>
                  <ul className="mt-1 list-disc pl-5">{proposal.unavailable.map((item, index) => <li key={`${item.name}-${index}`}><b>{item.name}</b>{item.reason === 'out_of_stock' ? ' (en rupture)' : ''}</li>)}</ul>
                </div>
              )}
              {proposal && proposal.adjusted.length > 0 && (
                <ul className="mt-2 space-y-0.5">{proposal.adjusted.map((item, index) => <li key={`${item.name}-${index}`}>Quantité ajustée : {item.name} {item.from} → {item.to}{item.reason === 'stock' ? ' (stock disponible)' : ' (quantité de vente actuelle)'}</li>)}</ul>
              )}
              {reorder.added > 0 && <p className="mt-2 text-xs">Les prix affichés au panier sont les prix actuels.</p>}
              {reorder.added > 0 && <Link href="/cart" className={`${primaryCls} mt-3`}>Voir mon panier</Link>}
            </>
          )}
        </div>
      )}

      {secondary.map((cta) => renderCta(cta, secondaryCls))}

      {supportOpen && support.length > 1 && (
        <ul id={supportId} aria-label="Contacter la boutique" className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          {support.map((channel) => {
            const Icon = SUPPORT_ICON[channel.kind];
            return <li key={channel.kind}>
              <a href={channel.href} target={channel.kind === 'email' ? undefined : '_blank'} rel="noopener noreferrer" className={secondaryCls}>
                <Icon size={17} aria-hidden="true" /> {channel.label}
              </a>
              {channel.detail && <p className="mt-1 text-center text-xs text-gray-500 select-all">{channel.detail}</p>}
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}
