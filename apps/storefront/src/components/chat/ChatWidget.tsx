'use client';

import { useState, useRef, useEffect } from 'react';
import { IconSparkles, IconX, IconSend, IconBrandWhatsapp, IconChevronRight } from '@tabler/icons-react';
import { rememberNalaProductTouch } from '@/lib/ai/nalaAttributionClient';
import { NalaProductActionCard } from '@/components/chat/NalaProductActionCard';
import { NalaCartPlanCard } from '@/components/chat/NalaCartPlanCard';
import type { NalaProductAction } from '@/lib/ai/nalaProductActionContract';
import {
  isNalaCartBuilderAffirmative,
  type NalaCartPlan,
} from '@/lib/ai/nalaCartPlanContract';
import { resolveLocale, useLocaleStore } from '@/lib/store/localeStore';

interface ChatWidgetProps {
  enabled: boolean;
  tenantName: string;
  tenantLocales: string[];
  tenantLocale: string;
  whatsappNumber: string | null;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  actions?: NalaProductAction[];
  cartPlan?: NalaCartPlan | null;
  cartPlanExpanded?: boolean;
}

const MAX_HISTORY_TURNS = 6;
const MOBILE_COMPACT_SCROLL_Y = 64;
const MOBILE_ONBOARDING_TIMEOUT_MS = 5000;
const NALA_PRIMARY = '#6D5AF6';
const NALA_DARK = '#4B3CC4';
const SUGGESTED_PROMPTS = [
  'Quels sont vos produits phares ?',
  'Je cherche un produit précis',
  'Je veux cuisiner du ndolé',
  'Avez-vous des produits sans gluten ?',
  'Informations sur la livraison',
];

function whatsappHref(whatsappNumber: string): string {
  return `https://wa.me/${whatsappNumber.replace(/[^\d]/g, '')}`;
}

function createClientSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function currentDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (window.matchMedia('(max-width: 767px)').matches) return 'mobile';
  if (window.matchMedia('(max-width: 1023px)').matches) return 'tablet';
  return 'desktop';
}

export function ChatWidget({ enabled, tenantName, tenantLocales, tenantLocale, whatsappNumber }: ChatWidgetProps) {
  const storeLocale = useLocaleStore((state) => state.locale);
  const storefrontLocale = resolveLocale(storeLocale, tenantLocales) || tenantLocale || 'fr';
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [compactLauncher, setCompactLauncher] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const clientSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    if (open || compactLauncher) return;

    const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
    const compactOnMobile = () => {
      if (isMobile()) setCompactLauncher(true);
    };

    function handleScroll() {
      if (window.scrollY >= MOBILE_COMPACT_SCROLL_Y) compactOnMobile();
    }

    function handlePointerDown(event: PointerEvent) {
      if (!isMobile() || launcherRef.current?.contains(event.target as Node)) return;
      setCompactLauncher(true);
    }

    handleScroll();
    const timeoutId = window.setTimeout(compactOnMobile, MOBILE_ONBOARDING_TIMEOUT_MS);
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open, compactLauncher]);

  if (!enabled) return null;

  async function handleSend(messageOverride?: string) {
    const message = (messageOverride ?? input).trim();
    if (!message || loading) return;

    let pendingPlanIndex = -1;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn?.role !== 'assistant') continue;
      if (turn.cartPlan && !turn.cartPlanExpanded) pendingPlanIndex = index;
      break;
    }
    if (pendingPlanIndex >= 0 && isNalaCartBuilderAffirmative(message)) {
      setTurns((current) => [
        ...current.map((turn, index) => (
          index === pendingPlanIndex ? { ...turn, cartPlanExpanded: true } : turn
        )),
        { role: 'user', text: message },
      ]);
      setInput('');
      return;
    }

    const history = turns.slice(-MAX_HISTORY_TURNS).map(({ role, text }) => ({ role, text }));
    clientSessionIdRef.current ??= createClientSessionId();
    setTurns((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');
    setLoading(true);
    setFailed(false);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history,
          clientSessionId: clientSessionIdRef.current,
          sourcePath: window.location.pathname,
          locale: storefrontLocale,
          storefrontLocale,
          deviceType: currentDeviceType(),
        }),
      });

      if (!res.ok) {
        setFailed(true);
        return;
      }

      const data = await res.json().catch(() => null);
      const reply = typeof data?.reply === 'string' ? data.reply : '';
      if (!reply) {
        setFailed(true);
        return;
      }

      rememberNalaProductTouch({
        interactionId: data?.interactionId,
        clientSessionId: clientSessionIdRef.current,
        matchedProductIds: data?.matchedProductIds,
        actionProductIds: data?.actionProductIds,
      });
      const actions = Array.isArray(data?.actions) ? data.actions as NalaProductAction[] : [];
      const cartPlan = data?.cartPlan && typeof data.cartPlan === 'object'
        ? data.cartPlan as NalaCartPlan
        : null;
      setTurns((prev) => [...prev, {
        role: 'assistant',
        text: reply,
        actions,
        cartPlan,
        cartPlanExpanded: false,
      }]);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => {
            setCompactLauncher(true);
            setOpen(true);
          }}
          aria-label="Ouvrir Nala, assistant shopping"
          className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-[60] flex h-12 items-center justify-center gap-2 overflow-hidden rounded-full bg-[#6D5AF6] px-4 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(109,90,246,0.35)] transition-[width,padding,background-color] duration-200 hover:bg-[#4B3CC4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6] focus-visible:ring-offset-2 active:bg-[#4B3CC4] motion-reduce:transition-none md:bottom-6 md:right-6 ${compactLauncher ? 'w-12 px-0' : 'w-[164px]'}`}
        >
          <IconSparkles size={22} aria-hidden="true" className="shrink-0" />
          {!compactLauncher && <span className="whitespace-nowrap">Demander à Nala</span>}
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Nala, assistant shopping"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-[60] flex max-h-[calc(100dvh-6rem-env(safe-area-inset-bottom))] w-[calc(100vw-1.5rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-[#E7E3FF] bg-white shadow-2xl md:bottom-6 md:right-6 md:max-h-[calc(100vh-3rem)]"
        >
          <div
            className="flex shrink-0 items-center justify-between px-4 py-3 text-white"
            style={{ background: `linear-gradient(135deg, ${NALA_PRIMARY}, ${NALA_DARK})` }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30">
                <IconSparkles size={22} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight">Nala</h2>
                <p className="truncate text-xs text-white/80">Assistant shopping par Lepefy</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setCompactLauncher(true);
                setOpen(false);
              }}
              aria-label="Fermer Nala"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <IconX size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2 border-b border-[#E7E3FF] bg-white px-4 py-2 text-xs text-gray-600">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" aria-hidden="true" />
            <span>En ligne</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain bg-[#F8F7FC] px-3 py-3">
            <div className="max-w-[90%] self-start rounded-2xl border border-[#ECEAF5] bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-700 shadow-sm">
              Bonjour ! 👋 Je suis Nala, votre assistant shopping. Je peux vous aider à trouver des produits chez {tenantName} et répondre à vos questions pratiques.
            </div>

            {turns.length === 0 && !loading && (
              <div className="mt-2 grid gap-2" aria-label="Suggestions de questions">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void handleSend(prompt)}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-[#CFC8FF] bg-white px-3 py-2 text-left text-sm font-medium text-[#5947E8] hover:border-[#6D5AF6] hover:bg-[#F3F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6] focus-visible:ring-offset-1"
                  >
                    <span>{prompt}</span>
                    <IconChevronRight size={18} aria-hidden="true" className="shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {turns.map((turn, i) => turn.role === 'user' ? (
              <div
                key={i}
                className="max-w-[85%] self-end rounded-2xl px-3 py-2 text-sm text-white shadow-sm"
                style={{ backgroundColor: NALA_PRIMARY }}
              >
                {turn.text}
              </div>
            ) : (
              <div key={i} className="flex w-[90%] max-w-[320px] flex-col gap-2 self-start">
                <div className="rounded-2xl border border-gray-100 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
                  {turn.text}
                </div>
                {turn.actions?.map((action) => (
                  <NalaProductActionCard
                    key={`${action.interactionId}:${action.product.id}`}
                    action={action}
                  />
                ))}
                {turn.cartPlan && (
                  <NalaCartPlanCard
                    plan={turn.cartPlan}
                    expanded={turn.cartPlanExpanded === true}
                    onPrepare={() => {
                      setTurns((current) => current.map((candidate, index) => (
                        index === i ? { ...candidate, cartPlanExpanded: true } : candidate
                      )));
                    }}
                  />
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-1 self-start rounded-2xl border border-gray-100 bg-white px-3 py-2 shadow-sm" aria-label="Nala prépare une réponse">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s] motion-reduce:animate-none" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s] motion-reduce:animate-none" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 motion-reduce:animate-none" />
              </div>
            )}

            {failed && (
              <div className="self-start max-w-[85%] bg-white border border-gray-100 rounded-2xl px-3 py-2 text-sm text-gray-700 shadow-sm flex flex-col gap-2">
                <span>Je ne peux pas répondre pour le moment.</span>
                {whatsappNumber && (
                  <a
                    href={whatsappHref(whatsappNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-full px-3 py-1.5 self-start"
                  >
                    <IconBrandWhatsapp size={16} />
                    Contacter sur WhatsApp
                  </a>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-t border-[#ECEAF5] bg-white px-3 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Posez votre question..."
                disabled={loading}
                className="min-w-0 flex-1 rounded-full border border-gray-200 bg-[#F8F7FC] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6D5AF6] focus:ring-offset-0 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={loading || !input.trim()}
                aria-label="Envoyer"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#6D5AF6] text-white transition-colors hover:bg-[#4B3CC4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6] focus-visible:ring-offset-2 active:bg-[#4B3CC4] disabled:opacity-40 motion-reduce:transition-none"
              >
                <IconSend size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] leading-tight text-gray-400">Réponses générées par IA. Vérifiez les informations.</p>
          </div>
        </section>
      )}
    </>
  );
}
