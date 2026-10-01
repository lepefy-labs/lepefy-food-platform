/**
 * Capability richieste dalle API Gestion (/api/admin/gestion/**), usate dalla
 * mappa centrale fail-closed adminApiPermissions.ts. Funzione pura.
 */
export function gestionApiPermission(path: string, method: string): string | null {
  const verb = method.toUpperCase();
  const read = verb === 'GET' || verb === 'HEAD';
  const rest = path.replace(/^\/api\/admin\/gestion/, '');

  if (rest === '/products') return read ? 'purchases.view' : null;

  if (/^\/purchases\/[^/]+\/receipts$/.test(rest)) return verb === 'POST' ? 'inventory.manage' : null;
  if (/^\/receipts\/[^/]+\/reverse$/.test(rest)) return verb === 'POST' ? 'inventory.manage' : null;
  if (rest === '/inventory/adjustments') return verb === 'POST' ? 'inventory.manage' : null;
  if (rest === '/inventory/products') return read ? 'inventory.view' : null;
  if (/^\/purchases\/[^/]+\/due-date$/.test(rest)) return verb === 'POST' ? 'purchases.manage' : null;

  if (/^\/payments\/[^/]+\/verify$/.test(rest)) return verb === 'POST' ? 'supplier_payments.verify' : null;
  // Annullare un pagamento GIÀ verificato richiede anche supplier_payments.verify (controllo nel handler).
  if (/^\/payments\/[^/]+\/(void|allocations)$/.test(rest)) return verb === 'POST' ? 'treasury.manage' : null;
  if (/^\/allocations\/[^/]+\/reverse$/.test(rest)) return verb === 'POST' ? 'treasury.manage' : null;

  const documents = rest.match(/^\/documents\/(supplier|purchase|receipt|supplier_payment)\/[^/]+(\/[^/]+)?$/);
  if (documents) {
    const domain = documents[1] === 'supplier' ? 'suppliers' : documents[1] === 'supplier_payment' ? 'treasury' : 'purchases';
    if (read) return `${domain}.view`;
    return verb === 'POST' || verb === 'DELETE' ? `${domain}.manage` : null;
  }

  if (/^\/suppliers(\/[^/]+)?$/.test(rest)) return read ? 'suppliers.view' : verb === 'POST' || verb === 'PATCH' ? 'suppliers.manage' : null;
  if (/^\/purchases(\/[^/]+)?$/.test(rest)) return read ? 'purchases.view' : verb === 'POST' || verb === 'PATCH' ? 'purchases.manage' : null;
  if (/^\/purchases\/[^/]+\/status$/.test(rest)) return verb === 'POST' ? 'purchases.manage' : null;
  if (/^\/payments(\/[^/]+)?$/.test(rest)) return read ? 'treasury.view' : verb === 'POST' ? 'treasury.manage' : null;

  return null;
}
