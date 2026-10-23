/**
 * Accès Supabase des scripts de démo : REST (PostgREST) + API Auth admin, avec
 * la clé service-role. fetch natif, aucune dépendance. Même interface que le
 * banc d'essai local (PGlite) : select / insert / update / rpc / deleteAuthUser.
 */
export function createRestStore({ url, serviceKey, dryRun = false, log = console.log }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const filter = (eq = {}) => Object.entries(eq).map(([column, value]) =>
    value === null ? `${column}=is.null` : Array.isArray(value) ? `${column}=in.(${value.map(encodeURIComponent).join(',')})` : `${column}=eq.${encodeURIComponent(value)}`).join('&');

  async function request(path, init = {}) {
    const response = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: ${response.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    dryRun,
    async select(table, columns, eq = {}) {
      const query = [`select=${columns}`, filter(eq)].filter(Boolean).join('&');
      return request(`/rest/v1/${table}?${query}`);
    },
    async insert(table, rows) {
      if (!rows.length) return [];
      if (dryRun) { log(`   [dry-run] ${table}: ${rows.length} ligne(s)`); return rows; }
      const inserted = [];
      for (let i = 0; i < rows.length; i += 500) {
        inserted.push(...await request(`/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows.slice(i, i + 500)) }));
      }
      return inserted;
    },
    async update(table, eq, patch) {
      if (dryRun) { log(`   [dry-run] update ${table} ${JSON.stringify(eq)}`); return []; }
      return request(`/rest/v1/${table}?${filter(eq)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    },
    async rpc(fn, params) {
      if (dryRun) { log(`   [dry-run] rpc ${fn}`); return null; }
      const rows = await request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) });
      return Array.isArray(rows) ? rows[0] ?? null : rows;
    },
    async deleteAuthUser(userId) {
      if (dryRun) return;
      await request(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
    },
  };
}
