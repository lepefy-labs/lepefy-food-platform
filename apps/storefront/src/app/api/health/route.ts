export function GET() {
  return Response.json({ ok: true, tenant: process.env.TENANT_SLUG ?? 'unknown', ts: new Date().toISOString() });
}
