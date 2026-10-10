import { auditFieldLabel } from '@/lib/audit/eventCatalog';
import type { AuditChange, SafeJson } from '@/lib/audit/sanitize';
import { formatMoney } from '@/lib/admin/format';
import { ORDER_STATUS_META, PAYMENT_STATUS_META } from '@/lib/admin/statusRegistry';
import { cn } from '@/lib/utils/cn';

const MONEY_FIELDS = new Set(['price', 'compare_at_price', 'subtotal', 'shipping_cost', 'total', 'flat_rate_amount']);

/** Readable value of a change (status labels, euros, Oui/Non). */
export function auditValueText(field: string, value: SafeJson | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'number' && MONEY_FIELDS.has(field)) return formatMoney(value);
  if (typeof value === 'string' && field === 'status') return ORDER_STATUS_META[value]?.label ?? value;
  if (typeof value === 'string' && field === 'payment_status') return PAYMENT_STATUS_META[value]?.label ?? value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * « Avant / Après » of an audit event. Redacted fields (personal data, secrets,
 * long texts) show « modifié » without any value: the journal never stored it.
 */
export default function AuditChanges({ changes, compact = false, className }: { changes: AuditChange[]; compact?: boolean; className?: string }) {
  if (changes.length === 0) return null;
  if (compact) {
    return (
      <p className={cn('break-words text-xs text-a-text-2', className)}>
        {changes.map((change, index) => (
          <span key={`${change.field}-${index}`}>
            {index > 0 && ' · '}
            {auditFieldLabel(change.field)}{' '}
            {change.redacted
              ? <span className="text-a-text-3">modifié</span>
              : <>{auditValueText(change.field, change.before)} → <b className="font-semibold text-a-text">{auditValueText(change.field, change.after)}</b></>}
          </span>
        ))}
      </p>
    );
  }
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-a-border', className)}>
      <table className="w-full text-sm">
        <caption className="sr-only">Modifications</caption>
        <thead className="bg-a-surface-2 text-left text-xs font-semibold text-a-text-2">
          <tr>
            <th scope="col" className="px-3 py-2">Champ</th>
            <th scope="col" className="px-3 py-2">Avant</th>
            <th scope="col" className="px-3 py-2">Après</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-a-border">
          {changes.map((change, index) => (
            <tr key={`${change.field}-${index}`}>
              <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium text-a-text">{auditFieldLabel(change.field)}</th>
              {change.redacted ? (
                <td colSpan={2} className="px-3 py-2 text-a-text-3">Modifié (valeur non conservée)</td>
              ) : (
                <>
                  <td className="break-words px-3 py-2 text-tone-danger-fg"><span className="sr-only">Avant : </span><del>{auditValueText(change.field, change.before)}</del></td>
                  <td className="break-words px-3 py-2 font-semibold text-tone-success-fg"><span className="sr-only">Après : </span>{auditValueText(change.field, change.after)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
