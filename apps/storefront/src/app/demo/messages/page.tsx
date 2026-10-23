import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDemoContext } from '@/lib/demo/server/demoContext';
import { countDemoEvent } from '@/lib/demo/server/demoServices';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const CHANNEL_LABELS: Record<string, string> = { email: 'E-mail', whatsapp: 'WhatsApp', n8n: 'Automatisation', shipping: 'Expédition' };

interface SimulatedMessage { id: string; channel: string; kind: string; recipient_hint: string | null; subject: string | null; preview: string | null; created_at: string }

/** Ce que la boutique aurait envoyé : aucun de ces messages n'est parti. Destinataires masqués. */
export default async function DemoMessagesPage() {
  const demo = await getDemoContext();
  if (!demo) notFound();
  await countDemoEvent('messages.view');
  const { data, error } = await createServiceClient().from('demo_simulated_messages')
    .select('id, channel, kind, recipient_hint, subject, preview, created_at')
    .eq('tenant_id', demo.tenant.id)
    .order('created_at', { ascending: false })
    .limit(30);
  const messages = (data ?? []) as SimulatedMessage[];
  const time = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <Link href="/demo" className="text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline">← Retour à la démo</Link>
        <h1 className="font-display text-2xl font-semibold text-a-text">Messages simulés</h1>
        <p className="text-sm text-a-text-2">
          Dans la démo, aucun e-mail ni message WhatsApp ne part. Voici ce que la boutique aurait envoyé, les plus récents en premier.
        </p>
      </header>
      {error && <p role="alert" className="text-sm text-tone-danger-fg">Les messages n’ont pas pu être chargés. Rechargez la page.</p>}
      {!error && messages.length === 0 && (
        <p className="rounded-[10px] border border-a-border bg-a-surface p-5 text-sm text-a-text-2">
          Aucun message pour l’instant. Passez une commande de test dans la boutique : la confirmation apparaîtra ici.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {messages.map((message) => (
          <li key={message.id} className="flex flex-col gap-2 rounded-[10px] border border-a-border bg-a-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-a-text-3">
              <span className="rounded-full bg-a-surface-2 px-2 py-0.5 font-semibold text-a-text-2">{CHANNEL_LABELS[message.channel] ?? message.channel}</span>
              <span>{message.kind}</span>
              {message.recipient_hint && <span>· à {message.recipient_hint}</span>}
              <span className="ml-auto tabular-nums">{time.format(new Date(message.created_at))}</span>
            </div>
            {message.subject && <p className="text-sm font-semibold text-a-text">{message.subject}</p>}
            {message.preview && <p className="whitespace-pre-line text-sm text-a-text-2">{message.preview}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
