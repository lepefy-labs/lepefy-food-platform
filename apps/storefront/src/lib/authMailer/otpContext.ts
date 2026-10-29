import { issueContext, withContext, type ContextKind } from './core/contextToken';

/**
 * `emailRedirectTo` carrying the signed tenant context for the Auth Mailer
 * (docs/AUTH_MAILER_MULTITENANT.md). Inert until AUTH_MAILER_CONTEXT_ENABLED=1:
 * with Supabase SMTP still active the redirect is unused by the OTP email, and a
 * redirect outside the Auth allow-list must never be introduced before cutover.
 */
export function authMailerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_MAILER_CONTEXT_ENABLED === '1' && !!env.AUTH_MAILER_CONTEXT_SECRET && !!env.NEXT_PUBLIC_APP_URL;
}

export async function authMailRedirectOptions(
  input: { tenantId: string | null; kind: ContextKind; email: string; workspace?: string; redirectPath?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ emailRedirectTo?: string }> {
  if (!authMailerEnabled(env)) return {};
  const token = await issueContext(env.AUTH_MAILER_CONTEXT_SECRET as string, {
    tid: input.tenantId,
    kind: input.kind,
    email: input.email,
    ws: input.workspace,
  });
  const base = new URL(input.redirectPath ?? '/', env.NEXT_PUBLIC_APP_URL as string).toString();
  return { emailRedirectTo: withContext(base, token) };
}
