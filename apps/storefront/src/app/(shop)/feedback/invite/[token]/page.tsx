import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { hashOpaqueToken, isInviteTokenExpired, isOpaqueToken, TESTER_SESSION_COOKIE } from '@/lib/feedback/testerInviteTokens';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invitation testeur', robots: { index: false, follow: false } };

export default async function TesterInvitePage({ params }: { params: { token: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  let state: 'ready' | 'active' | 'already' | 'invalid' = 'invalid';
  if (isOpaqueToken(params.token)) {
    const { data: invite } = await service.from('tester_feedback_invites')
      .select('id, tenant_id, campaign_id, invite_token_created_at, invite_token_used_at, session_token_hash, sent_at, revoked_at')
      .eq('invite_token_hash', hashOpaqueToken(params.token)).maybeSingle();
    if (invite && invite.tenant_id === tenant.id && invite.sent_at && !invite.revoked_at && !isInviteTokenExpired(invite.invite_token_created_at)) {
      const { data: campaign } = await service.from('tester_feedback_campaigns').select('id').eq('id', invite.campaign_id).eq('tenant_id', tenant.id).eq('active', true).maybeSingle();
      if (campaign) {
        if (!invite.invite_token_used_at) state = 'ready';
        else {
          const session = cookies().get(TESTER_SESSION_COOKIE)?.value;
          state = session && invite.session_token_hash === hashOpaqueToken(session) ? 'active' : 'already';
        }
      }
    }
  }

  return <main className="mx-auto flex min-h-[70vh] w-full max-w-lg items-center px-4 py-10">
    <section className="w-full rounded-3xl border border-black/5 bg-white p-7 text-center shadow-xl shadow-black/5 sm:p-10">
      {tenant.logo_url ? <img src={tenant.logo_url} alt={tenant.name} className="mx-auto h-16 w-16 rounded-2xl object-contain" /> : null}
      {state === 'ready' ? <>
        <h1 className="mt-5 text-2xl font-bold text-gray-950">Votre invitation est prête 💜</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">Vous allez accéder à l’espace de feedback réservé aux testeurs invités.</p>
        <form action="/api/feedback/invite/activate" method="post" className="mt-7">
          <input type="hidden" name="token" value={params.token} />
          <button type="submit" className="w-full rounded-2xl px-5 py-3.5 text-base font-bold text-white focus:outline-none focus:ring-2 focus:ring-offset-2" style={{ backgroundColor: tenant.primary_color }}>Accéder au formulaire</button>
        </form>
      </> : state === 'active' ? <>
        <h1 className="mt-5 text-2xl font-bold text-gray-950">Invitation déjà activée</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">Votre session de testeur est active sur cet appareil.</p>
        <a href="/feedback" className="mt-7 inline-block w-full rounded-2xl px-5 py-3.5 text-base font-bold text-white" style={{ backgroundColor: tenant.primary_color }}>Accéder au formulaire</a>
      </> : state === 'already' ? <>
        <h1 className="mt-5 text-2xl font-bold text-gray-950">Cette invitation a déjà été activée.</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">Si vous avez besoin d’un nouveau lien, contactez l’équipe qui vous a invité.</p>
      </> : <>
        <h1 className="mt-5 text-2xl font-bold text-gray-950">Cette invitation n’est plus valide.</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">Demandez un nouveau lien à l’équipe qui vous a invité.</p>
      </>}
    </section>
  </main>;
}
