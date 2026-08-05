import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Digital Asset Links (verifica dominio Play Store per la TWA, cf. Bubblewrap).
// Chaque tenant a son propre package name / fingerprint de signature — jamais
// de valeurs hardcodées ici, cf. manifest.ts et /api/pwa-icon pour le pattern.
export const dynamic = 'force-dynamic';

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';

  try {
    const tenant = await getTenant(slug);

    if (!tenant.android_package_name || !tenant.android_sha256_fingerprint) {
      return NextResponse.json([], { status: 200 });
    }

    return NextResponse.json(
      [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: tenant.android_package_name,
            sha256_cert_fingerprints: [tenant.android_sha256_fingerprint],
          },
        },
      ],
      { status: 200 },
    );
  } catch (err) {
    // Un échec de résolution tenant (Supabase indisponible, etc.) ne doit pas
    // faire échouer cette route — Google attend une réponse JSON valide, même
    // vide, plutôt qu'une 500. Repli identique au cas "pas d'app Android".
    console.error('[assetlinks.json] getTenant a échoué, repli sur []:', err);
    return NextResponse.json([], { status: 200 });
  }
}
