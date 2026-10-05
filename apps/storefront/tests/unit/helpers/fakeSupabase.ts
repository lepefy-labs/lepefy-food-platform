/**
 * Mini client Supabase en mémoire pour les tests unitaires (aucun réseau).
 * Supporte le sous-ensemble utilisé par les documents de commande et le
 * portail : select/eq/in/is/order + maybeSingle/single, insert, update.
 * `select` ignore la projection (renvoie les lignes complètes).
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface FakeDb {
  tables: Record<string, Row[]>;
  from(table: string): FakeQuery;
  /** Erreurs forcées par table (ex. table absente). */
  failures: Record<string, { code: string; message: string }>;
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row | Row[] | null = null;
  private single: 'maybe' | 'one' | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(_columns?: string) { return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  is(column: string, value: unknown) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
  order() { return this; }
  limit() { return this; }
  insert(payload: Row | Row[]) { this.mode = 'insert'; this.payload = payload; return this; }
  update(payload: Row) { this.mode = 'update'; this.payload = payload; return this; }
  maybeSingle() { this.single = 'maybe'; return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<T1 = any, T2 = never>(resolve?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null, reject?: ((reason: unknown) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }

  private run(): { data: unknown; error: unknown } {
    const failure = this.db.failures[this.table];
    if (failure) return { data: null, error: failure };
    const rows = (this.db.tables[this.table] ??= []);
    if (this.mode === 'insert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      for (const row of list) {
        if (this.table === 'order_public_access_tokens') {
          const clash = rows.some((r) => (r.tenant_id === row.tenant_id && r.token_hash === row.token_hash)
            || (r.tenant_id === row.tenant_id && r.order_id === row.order_id && r.purpose === row.purpose && !r.revoked_at));
          if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
      }
      for (const row of list) rows.push({ revoked_at: null, ...row });
      return { data: list, error: null };
    }
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.mode === 'update') {
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }
    if (this.single) return { data: matched[0] ?? null, error: null };
    return { data: matched, error: null };
  }
}

// `object[]` (pas `Row[]`) : les tests passent des lignes typées par interface.
export function fakeDb(tables: Record<string, object[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: tables as Record<string, Row[]>,
    failures: {},
    from(table: string) { return new FakeQuery(db, table); },
  };
  return db;
}
