import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { email, password } = await request.json()
  const cookieStore = cookies()

  // Collect cookies to set — applied explicitly to the response
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          pendingCookies.push(...cookiesToSet)
        },
      },
    }
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  console.log('[login route] signIn error:', error?.message ?? 'none')
  console.log('[login route] user:', data?.user?.email ?? 'null')
  console.log('[login route] cookies to set:', pendingCookies.map(c => c.name))

  if (error) {
    return NextResponse.json({ error: 'Identifiants incorrects.' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
  )

  console.log('[login route] response cookies set:', pendingCookies.map(c => c.name))

  return response
}
