'use client';

import { useState, useRef, useEffect } from 'react';
import { IconMessageCircle2, IconX, IconSend, IconBrandWhatsapp } from '@tabler/icons-react';

interface ChatWidgetProps {
  enabled: boolean;
  tenantName: string;
  whatsappNumber: string | null;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_HISTORY_TURNS = 6;

function whatsappHref(whatsappNumber: string): string {
  return `https://wa.me/${whatsappNumber.replace(/[^\d]/g, '')}`;
}

export function ChatWidget({ enabled, tenantName, whatsappNumber }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  if (!enabled) return null;

  async function handleSend() {
    const message = input.trim();
    if (!message || loading) return;

    const history = turns.slice(-MAX_HISTORY_TURNS);
    setTurns((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');
    setLoading(true);
    setFailed(false);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
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

      setTurns((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le chat"
          className="fixed bottom-[84px] right-4 md:bottom-6 z-50 w-[50px] h-[50px] rounded-full flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <IconMessageCircle2 size={24} />
        </button>
      )}

      {open && (
        <div className="fixed bottom-[84px] right-4 md:bottom-6 z-50 w-[calc(100vw-2rem)] max-w-sm h-[70vh] max-h-[520px] bg-white rounded-2xl shadow-lg flex flex-col overflow-hidden border border-gray-100">
          <div
            className="flex items-center justify-between px-4 py-3 text-white shrink-0"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <span className="font-semibold text-sm">{tenantName}</span>
            <button onClick={() => setOpen(false)} aria-label="Fermer le chat" className="opacity-90 hover:opacity-100">
              <IconX size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 bg-gray-50">
            <div className="max-w-[85%] self-start bg-white border border-gray-100 rounded-2xl px-3 py-2 text-sm text-gray-700 shadow-sm">
              Bonjour ! Je suis l&apos;assistant de {tenantName}. Je peux répondre sur nos produits et infos pratiques.
            </div>

            {turns.map((turn, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  turn.role === 'user'
                    ? 'self-end text-white'
                    : 'self-start bg-white border border-gray-100 text-gray-700'
                }`}
                style={turn.role === 'user' ? { backgroundColor: 'var(--color-primary)' } : undefined}
              >
                {turn.text}
              </div>
            ))}

            {loading && (
              <div className="self-start bg-white border border-gray-100 rounded-2xl px-3 py-2 shadow-sm flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
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

          <div className="flex items-center gap-2 px-3 py-3 border-t border-gray-100 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Écrivez votre message..."
              disabled={loading}
              className="flex-1 rounded-full border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-60"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Envoyer"
              className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 disabled:opacity-40 active:scale-95 transition-transform"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <IconSend size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
