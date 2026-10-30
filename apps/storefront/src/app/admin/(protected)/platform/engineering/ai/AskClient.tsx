'use client';

import { useRef, useState } from 'react';
import Button from '../../../../_components/ui/Button';

interface Citation { id: string; path: string; startLine: number | null; endLine: number | null; label: string; url: string }
type Reply =
  | { state: 'answered' | 'no_answer' | 'refused'; answer: string; citations: Citation[]; commitSha: string; toolCalls: number }
  | { state: string; message: string };
interface Turn { role: 'user' | 'assistant'; content: string; reply?: Reply }

const MAX_TURNS = 20;

export default function AskClient({ enabled }: { enabled: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setError('');
    const history = turns.slice(-6).map((turn) => ({ role: turn.role, content: turn.content }));
    setTurns((current) => [...current, { role: 'user' as const, content: text }].slice(-MAX_TURNS));
    setQuestion('');
    abort.current = new AbortController();
    try {
      const response = await fetch('/api/admin/platform/engineering/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ question: text, history }), signal: abort.current.signal,
      });
      const reply = (await response.json()) as Reply & { error?: string };
      if (!response.ok && !('state' in reply)) throw new Error((reply as { error?: string }).error ?? 'Richiesta non riuscita.');
      const content = 'answer' in reply ? reply.answer : 'message' in reply ? reply.message : '';
      setTurns((current) => [...current, { role: 'assistant' as const, content, reply }].slice(-MAX_TURNS));
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') setError(caught instanceof Error ? caught.message : 'Richiesta non riuscita.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3" aria-live="polite">
        {turns.map((turn, index) => (
          <li key={index} className={`rounded-[10px] border p-3 text-sm ${turn.role === 'user' ? 'border-a-border bg-a-surface-2' : 'border-a-border bg-a-surface'}`}>
            <p className="mb-1 text-xs font-semibold text-a-text-3">{turn.role === 'user' ? 'Tu' : 'Assistente'}</p>
            <p className="whitespace-pre-wrap text-a-text">{turn.content}</p>
            {turn.reply && 'citations' in turn.reply && turn.reply.citations.length > 0 && (
              <div className="mt-3 border-t border-a-border pt-2">
                <p className="text-xs font-semibold text-a-text-2">Fonti al commit {turn.reply.commitSha.slice(0, 8)}</p>
                <ul className="mt-1 space-y-1">
                  {turn.reply.citations.map((citation) => (
                    <li key={citation.id} className="text-xs">
                      <span className="mr-2 rounded bg-a-surface-2 px-1.5 py-0.5 font-mono text-a-text-2">{citation.id}</span>
                      <a href={citation.url} target="_blank" rel="noreferrer noopener" className="break-all font-mono text-a-text underline">
                        {citation.path}{citation.startLine ? `:${citation.startLine}${citation.endLine && citation.endLine !== citation.startLine ? `-${citation.endLine}` : ''}` : ''}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {turn.reply && 'answer' in turn.reply && turn.reply.state === 'answered' && (
              <p className="mt-2 text-xs text-a-text-3">Risposta generata dall’AI sulle fonti elencate: verifica sempre il codice citato.</p>
            )}
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="text-sm text-tone-danger-fg">{error}</p>}

      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="eng-ask" className="sr-only">Domanda tecnica</label>
        <textarea
          id="eng-ask" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1000} rows={3} disabled={!enabled || busy}
          placeholder={enabled ? 'Es.: dove viene validata la quantità minima al checkout?' : 'Assistente spento'}
          className="w-full rounded-[10px] border border-a-border bg-a-surface p-3 text-sm text-a-text disabled:opacity-60"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={!enabled || busy || question.trim().length < 3}>{busy ? 'Ricerca in corso…' : 'Chiedi'}</Button>
          {turns.length > 0 && <Button type="button" variant="ghost" onClick={() => { abort.current?.abort(); setTurns([]); setError(''); setBusy(false); }}>Nuova conversazione</Button>}
          <span className="text-xs text-a-text-3">Non inserire segreti: la domanda non viene salvata, ma passa al provider AI.</span>
        </div>
      </form>
    </div>
  );
}
