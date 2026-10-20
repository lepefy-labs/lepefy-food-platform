/**
 * Migrations 160 and 161 may reach production after the code (migrations are applied
 * by hand). Reads that select its columns retry without them: the orders then
 * have no snapshot, i.e. the historical digital rules. Writes of those columns
 * only happen once the `order_preparation` module is registered (same
 * migration), so they never run before it.
 */
// Migration 160 (preparation) and 161 (closure) columns.
const PREPARATION_COLUMN = /preparation_mode|picking_list_printed_at|paper_preparation_|cold_chain_packing_declared_at|preparation_unverified_at|closure_type|closure_reason|closed_at/;

export function isMissingPreparationColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (code === '42703' || code === 'PGRST204') && PREPARATION_COLUMN.test(String(message ?? ''));
}

/** Removes the migration-160 columns from a PostgREST select list. */
export function withoutPreparationColumns(select: string): string {
  return select.split(',').map((column) => column.trim()).filter((column) => column && !PREPARATION_COLUMN.test(column)).join(', ');
}
