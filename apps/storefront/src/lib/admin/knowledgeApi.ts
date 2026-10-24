import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const KNOWLEDGE_ENTRY_SELECT = 'id, title, category, content, source, reviewed_by, reviewed_at, active, created_at, updated_at, library_key, library_locale, library_version, revision';

export async function getKnowledgeAdminEmail(): Promise<string | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}
