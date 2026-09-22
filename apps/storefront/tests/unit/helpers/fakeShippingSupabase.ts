/**
 * Faux client Supabase en mémoire, suffisant pour les requêtes du module
 * Shipping Intelligence (select/insert/update + filtres eq/in/gte/lte/lt/not/
 * ilike, order, range, limit). Reproduit le plafond PostgREST de 1000 lignes
 * par réponse et journalise chaque requête exécutée pour vérifier le
 * tenant scope.
 */
type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'in' | 'gte' | 'lte' | 'lt' | 'not_null' | 'ilike'; col: string; value: unknown };

export interface ExecutedQuery {
  table: string;
  action: 'select' | 'insert' | 'update';
  filters: Filter[];
}

export const SERVER_MAX_ROWS = 1000;

let idCounter = 0;
export function fakeId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}-${String(idCounter).padStart(6, '0')}`;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return String(a) < String(b) ? -1 : 1;
}

function cmpValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const isoA = typeof a === 'string' && a.includes('T') ? Date.parse(a) : NaN;
  const isoB = typeof b === 'string' && b.includes('T') ? Date.parse(b) : NaN;
  if (!Number.isNaN(isoA) && !Number.isNaN(isoB)) return isoA - isoB;
  return compare(a, b);
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private filters: Filter[] = [];
  private orders: Array<{ col: string; ascending: boolean }> = [];
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitN: number | null = null;
  private head = false;
  private countExact = false;
  private singleMode: 'maybe' | 'one' | null = null;
  private returning = false;
  private action: ExecutedQuery['action'] = 'select';
  private payload: Row | Row[] | null = null;

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.action !== 'select') this.returning = true;
    if (opts?.head) this.head = true;
    if (opts?.count === 'exact') this.countExact = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.action = 'insert'; this.payload = rows; return this; }
  update(values: Row) { this.action = 'update'; this.payload = values; return this; }
  eq(col: string, value: unknown) { this.filters.push({ op: 'eq', col, value }); return this; }
  in(col: string, value: unknown[]) { this.filters.push({ op: 'in', col, value }); return this; }
  gte(col: string, value: unknown) { this.filters.push({ op: 'gte', col, value }); return this; }
  lte(col: string, value: unknown) { this.filters.push({ op: 'lte', col, value }); return this; }
  lt(col: string, value: unknown) { this.filters.push({ op: 'lt', col, value }); return this; }
  ilike(col: string, value: string) { this.filters.push({ op: 'ilike', col, value }); return this; }
  not(col: string, _op: string, _value: unknown) { this.filters.push({ op: 'not_null', col, value: null }); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, ascending: opts?.ascending !== false }); return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(n: number) { this.limitN = n; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  single() { this.singleMode = 'one'; return this; }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.col];
      switch (f.op) {
        case 'eq': return v === f.value;
        case 'in': return (f.value as unknown[]).includes(v);
        case 'gte': return cmpValues(v, f.value) >= 0;
        case 'lte': return cmpValues(v, f.value) <= 0;
        case 'lt': return cmpValues(v, f.value) < 0;
        case 'not_null': return v !== null && v !== undefined;
        case 'ilike': return String(v).toLowerCase().startsWith(String(f.value).replace(/%$/, '').toLowerCase());
        default: return true;
      }
    });
  }

  private execute(): { data: unknown; error: null; count: number | null } {
    this.db.log.push({ table: this.table, action: this.action, filters: [...this.filters] });
    const tableRows = this.db.tables[this.table] ??= [];

    if (this.action === 'insert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const now = new Date(this.db.clock()).toISOString();
      const inserted = rows.map((r) => ({ id: fakeId(this.table), observed_at: now, created_at: now, ...r }));
      tableRows.push(...inserted);
      if (this.singleMode) return { data: inserted[0] ?? null, error: null, count: null };
      return { data: this.returning ? inserted : null, error: null, count: null };
    }

    const matched = tableRows.filter((r) => this.matches(r));

    if (this.action === 'update') {
      for (const row of matched) Object.assign(row, this.payload);
      const data = this.returning ? matched : null;
      if (this.singleMode) return { data: matched[0] ?? null, error: null, count: null };
      return { data, error: null, count: null };
    }

    const sorted = [...matched];
    for (const o of [...this.orders].reverse()) {
      sorted.sort((a, b) => (o.ascending ? 1 : -1) * compare(a[o.col], b[o.col]));
    }
    if (this.head) return { data: null, error: null, count: sorted.length };

    let window = sorted;
    if (this.rangeFrom !== null && this.rangeTo !== null) window = window.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN !== null) window = window.slice(0, this.limitN);
    window = window.slice(0, SERVER_MAX_ROWS);
    if (this.singleMode) return { data: window[0] ?? null, error: null, count: null };
    return { data: window.map((r) => ({ ...r })), error: null, count: this.countExact ? sorted.length : null };
  }

  then<TResult1 = { data: unknown; error: null; count: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }
}

export class FakeDb {
  log: ExecutedQuery[] = [];
  clock: () => number = () => Date.now();
  tables: Record<string, Row[]>;
  constructor(tables: Record<string, object[]> = {}) {
    this.tables = tables as Record<string, Row[]>;
  }

  client() {
    const from = (table: string) => new FakeQuery(this, table);
    return { from } as unknown as ReturnType<typeof import('@/lib/supabase/server').createServiceClient>;
  }

  /** Requêtes sur `table` qui ne filtrent PAS par tenant_id = tenantId. */
  unscopedQueries(table: string, tenantId: string): ExecutedQuery[] {
    return this.log.filter((q) => q.table === table
      && !q.filters.some((f) => f.op === 'eq' && f.col === 'tenant_id' && f.value === tenantId));
  }
}
