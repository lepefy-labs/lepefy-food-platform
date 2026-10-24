import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { embedText } from '@/lib/ai/embeddings';
import { logAiUsage } from '@/lib/ai/usageTracking';
import { knowledgeFingerprint, knowledgeIssue } from '@/lib/admin/knowledgeSafety';
import { getKnowledgeAdminEmail } from '@/lib/admin/knowledgeApi';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const adoptSchema = z.object({
  confirmed: z.literal(true),
  ids: z.array(z.string().uuid()).min(1).max(8),
  replaceExistingIds: z.array(z.string().uuid()).max(8).optional(),
}).strict();

export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1));
  const size = 20;
  const locale = params.get('locale') || 'fr';
  const area = params.get('area') || '';
  const category = params.get('category') || '';
  const search = (params.get('q') || '').trim().slice(0, 100).replace(/[%_,]/g, ' ');
  const db = createServiceClient();
  let query = db.from('knowledge_library').select('id, stable_key, locale, version, title, category, content, scope, cultural_area, provenance, verification_status, reviewed_at, review_due_at, requires_tenant_confirmation', { count: 'exact' })
    .eq('is_current', true).eq('verification_status', 'verified').eq('locale', locale);
  if (area) query = query.or(`scope.eq.global,cultural_area.eq.${area.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)}`);
  if (category) query = query.eq('category', category);
  if (search) query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
  const { data, count, error } = await query.order('title').range((page - 1) * size, page * size - 1);
  if (error) return NextResponse.json({ error: 'Bibliothèque indisponible.' }, { status: 500 });
  const { data: culturalAreas } = await db.from('knowledge_library').select('cultural_area')
    .eq('is_current', true).eq('verification_status', 'verified').eq('locale', locale).not('cultural_area', 'is', null);
  const { data: adopted } = await db.from('tenant_knowledge_base').select('library_key, library_locale, library_version')
    .eq('tenant_id', tenant.id).is('deleted_at', null).not('library_key', 'is', null);
  const versions = new Map((adopted ?? []).map((row) => [`${row.library_key}:${row.library_locale}`, row.library_version]));
  return NextResponse.json({ entries: (data ?? []).map((row) => ({ ...row, adopted: versions.has(`${row.stable_key}:${row.locale}`), adoptedVersion: versions.get(`${row.stable_key}:${row.locale}`) ?? null, updateAvailable: Number(versions.get(`${row.stable_key}:${row.locale}`) ?? 0) > 0 && Number(versions.get(`${row.stable_key}:${row.locale}`)) < row.version })), total: count ?? 0, page, pageSize: size, areas: [...new Set((culturalAreas ?? []).map((row) => row.cultural_area).filter(Boolean))].sort() });
}

export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const parsed = adoptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    return NextResponse.json({ error: 'Sélection invalide. Confirmez au plus huit connaissances distinctes.' }, { status: 400 });
  }
  const replacements = new Set(parsed.data.replaceExistingIds ?? []);
  if ([...replacements].some((id) => !parsed.data.ids.includes(id))) return NextResponse.json({ error: 'Mise à jour invalide.' }, { status: 400 });
  const db = createServiceClient();
  const { data: library, error } = await db.from('knowledge_library').select('*')
    .in('id', parsed.data.ids).eq('is_current', true).eq('verification_status', 'verified');
  if (error || !library || library.length !== parsed.data.ids.length) {
    return NextResponse.json({ error: 'Une connaissance n’est plus disponible ou vérifiée.' }, { status: 409 });
  }
  const { data: existing, error: existingError } = await db.from('tenant_knowledge_base')
    .select('id, content, library_key, library_locale, library_version').eq('tenant_id', tenant.id).is('deleted_at', null);
  if (existingError) return NextResponse.json({ error: 'Vérification des doublons impossible.' }, { status: 500 });
  const fingerprints = new Set((existing ?? []).map((row) => knowledgeFingerprint(row.content)));
  const adoptedByKey = new Map((existing ?? []).filter((row) => row.library_key).map((row) => [`${row.library_key}:${row.library_locale}`, row]));
  const adminEmail = await getKnowledgeAdminEmail();
  const added: string[] = [];
  const updated: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const item of library) {
    const issue = knowledgeIssue(item.content);
    const fingerprint = knowledgeFingerprint(item.content);
    const key = `${item.stable_key}:${item.locale}`;
    const adopted = adoptedByKey.get(key);
    const duplicate = adopted
      ? (existing ?? []).some((row) => row.id !== adopted.id && knowledgeFingerprint(row.content) === fingerprint)
      : fingerprints.has(fingerprint);
    if (issue || duplicate || (adopted && (Number(adopted.library_version) >= item.version || !replacements.has(item.id)))) {
      skipped.push({ id: item.id, reason: issue ?? 'Déjà présent dans vos connaissances.' });
      continue;
    }
    let vector = item.embedding;
    if (!vector) {
      try {
        const embedding = await embedText(item.content);
        vector = embedding.vector;
        await db.from('knowledge_library').update({ embedding: vector }).eq('id', item.id).is('embedding', null);
        await logAiUsage({ tenantId: tenant.id, endpoint: 'knowledge-library-embed', provider: 'gemini', model: 'gemini-embedding-001', inputTokens: embedding.tokenCount ?? undefined, outputTokens: 0, status: 'success' });
      } catch {
        skipped.push({ id: item.id, reason: 'Indexation indisponible. Réessayez.' });
        continue;
      }
    }
    const copy = {
      tenant_id: tenant.id, title: item.title, category: item.category, content: item.content,
      source: `library:${item.stable_key}`, library_key: item.stable_key,
      library_locale: item.locale, library_version: item.version,
      embedding: vector, reviewed_by: adminEmail,
      reviewed_at: new Date().toISOString(), modified_by: adminEmail,
    };
    const { error: writeError } = adopted
      ? await db.from('tenant_knowledge_base').update(copy).eq('id', adopted.id).eq('tenant_id', tenant.id).is('deleted_at', null)
      : await db.from('tenant_knowledge_base').insert({ ...copy, active: true });
    if (writeError) {
      skipped.push({ id: item.id, reason: 'Ajout impossible ou déjà effectué.' });
    } else {
      if (adopted) updated.push(item.id); else added.push(item.id);
      fingerprints.add(fingerprint);
    }
  }
  return NextResponse.json({ added, updated, skipped }, { status: skipped.length ? 207 : 201 });
}
