import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()
  const cookieStore = cookies()

  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = []

  // Provide both old (get/set/remove) and new (getAll/setAll) cookie APIs.
  // @supabase/ssr@0.3.x calls set() internally — not setAll() — so both are needed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          pendingCookies.push(...cookiesToSet)
        },
        get(name: string) { return cookieStore.get(name)?.value },
        set(name: string, value: string, options?: Record<string, unknown>) {
          pendingCookies.push({ name, value, options })
        },
        remove(name: string, options?: Record<string, unknown>) {
          pendingCookies.push({ name, value: '', options: { ...options, maxAge: 0 } })
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    }
  )

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.json({ error: 'Identifiants incorrects.' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
  )

  return response
}
