export function GET() {
  return Response.json({ ok: true, tenant: process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'unknown', ts: new Date().toISOString() });
}
