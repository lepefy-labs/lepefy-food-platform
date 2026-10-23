import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformBranding } from '@/lib/admin/platformBranding';
import { adminTokensCss } from '@/lib/admin/tokens';
import { getDemoContext } from '@/lib/demo/server/demoContext';

export async function generateMetadata(): Promise<Metadata> {
  const robots = { index: false, follow: false };
  return (await getDemoContext()) ? { title: 'Démonstration Lepefy', robots } : { robots };
}

export const dynamic = 'force-dynamic';

/**
 * Pages de la démo (/demo, /demo/messages) : identité Lepefy (tokens admin,
 * même système que l'administration), jamais l'habillage du tenant.
 * Hors déploiement de démo : 404.
 */
export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  if (!(await getDemoContext())) notFound();
  const platform = await getPlatformBranding();
  const css = adminTokensCss(platform).replace(/</g, '\\3C ');
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="min-h-screen bg-a-bg text-a-text">{children}</div>
    </>
  );
}
