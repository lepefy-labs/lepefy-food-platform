import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Lascia passare la pagina di login
  if (pathname === '/admin/login') return NextResponse.next()

  // Proteggi tutto /admin
  if (pathname.startsWith('/admin')) {
    let supabaseResponse = NextResponse.next({ request })

    try {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll()
            },
            setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
              cookiesToSet.forEach(({ name, value }) =>
                request.cookies.set(name, value)
              )
              supabaseResponse = NextResponse.next({ request })
              cookiesToSet.forEach(({ name, value, options }) =>
                supabaseResponse.cookies.set(name, value, options as Record<string, unknown>)
              )
            },
          },
        }
      )

      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        const url = request.nextUrl.clone()
        url.pathname = '/admin/login'
        return NextResponse.redirect(url)
      }

      return supabaseResponse
    } catch {
      // Se il client Supabase fallisce, blocca l'accesso per sicurezza
      const url = request.nextUrl.clone()
      url.pathname = '/admin/login'
      return NextResponse.redirect(url)
    }
  }

  return NextResponse.next()
}

export const config = {
  // Matcher esplicito: cattura /admin e tutti i sottopercorsi
  matcher: ['/admin', '/admin/:path+'],
}
