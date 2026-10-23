import Link from 'next/link';
import { IconEye } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/admin/format';

/**
 * Bandeau de la visite lecture seule (rôle demo_visitor, migration 167) : dit
 * pourquoi les actions sont absentes ou refusées et quand la visite se termine.
 */
export default async function DemoVisitorBanner({ userId }: { userId: string }) {
  const { data } = await createServiceClient().from('demo_visitor_accounts').select('expires_at').eq('user_id', userId).maybeSingle();
  const expiresAt = data?.expires_at ? new Date(data.expires_at) : null;
  const until = expiresAt ? formatDate(expiresAt, 'time', 'Europe/Paris') : null;
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-tone-info-border bg-tone-info-bg px-3 py-2 text-sm text-tone-info-fg">
      <p className="flex items-center gap-2">
        <IconEye size={16} aria-hidden="true" />
        <span><span className="font-semibold">Mode visite</span> · lecture seule. Les actions sont désactivées pour garder la démo propre{until ? ` · visite ouverte jusqu’à ${until}` : ''}.</span>
      </p>
      <Link href="/demo" className="font-semibold underline underline-offset-2">Demander une démonstration guidée</Link>
    </div>
  );
}
