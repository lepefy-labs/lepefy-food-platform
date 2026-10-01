import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  BUSINESS_MANAGEMENT_FLAG, isBusinessReference, isMoneyAmount, purchasePaymentState, receivedPercent, validateAllocationPlan,
} from '../../src/lib/gestion/domain';
import { gestionApiPermission } from '../../src/lib/gestion/permissions';
import { gestionRpcError } from '../../src/lib/gestion/errors';
import { detectDocumentMime, safeFileName } from '../../src/lib/gestion/files';
import { createPaymentSchema, receiptSchema, updatePurchaseSchema, updateSupplierSchema } from '../../src/lib/gestion/schemas';
import { FEATURE_FLAG_DEFINITIONS, FEATURE_FLAG_KEY_PATTERN } from '../../src/lib/featureFlags/featureFlagRegistry';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';
import { canAdmin, type AdminAccessContext } from '../../src/lib/auth/adminRbac';

const SRC = join(__dirname, '../../src');

function walk(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path, name) : entry === name ? [path] : [];
  });
}

const API_ROOT = join(SRC, 'app/api/admin/gestion');
const PAGE_ROOT = join(SRC, 'app/admin/(protected)/gestion');
const apiRoutes = walk(API_ROOT, 'route.ts');
const pages = walk(PAGE_ROOT, 'page.tsx');

// ─── Feature gate ────────────────────────────────────────────────────────────

test('business_management is a registered release flag, off unless a row enables it', () => {
  const definition = FEATURE_FLAG_DEFINITIONS.find((flag) => flag.key === BUSINESS_MANAGEMENT_FLAG);
  expect(definition?.label).toBe('Gestion du commerce');
  expect(FEATURE_FLAG_KEY_PATTERN.test(BUSINESS_MANAGEMENT_FLAG)).toBe(true);
});

test('every Gestion API handler goes through the feature guard and is never cached', () => {
  expect(apiRoutes.length).toBeGreaterThanOrEqual(16);
  for (const file of apiRoutes) {
    const source = readFileSync(file, 'utf8');
    const handlers = source.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? [];
    const guards = source.match(/requireBusinessManagementApi\(/g) ?? [];
    expect(guards.length, file).toBe(handlers.length);
    expect(source, file).toContain("export const dynamic = 'force-dynamic'");
    expect(source, file).toContain("export const fetchCache = 'force-no-store'");
  }
});

test('every Gestion page checks the flag server-side and is never cached', () => {
  expect(pages.length).toBeGreaterThanOrEqual(10);
  for (const file of pages) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).toContain('requireBusinessManagementPage(');
    expect(source, file).toContain("export const dynamic = 'force-dynamic'");
    expect(source, file).toContain("export const fetchCache = 'force-no-store'");
  }
});

test('no em dash in Gestion UI copy', () => {
  const uiFiles = walk(PAGE_ROOT, 'page.tsx').concat(
    readdirSync(join(PAGE_ROOT, '_components')).map((file) => join(PAGE_ROOT, '_components', file)),
    walk(PAGE_ROOT, 'SupplierForm.tsx'), walk(PAGE_ROOT, 'PurchaseForm.tsx'), walk(PAGE_ROOT, 'ReceiptForm.tsx'),
    walk(PAGE_ROOT, 'PaymentForm.tsx'), walk(PAGE_ROOT, 'AllocateForm.tsx'),
  );
  for (const file of uiFiles) expect(readFileSync(file, 'utf8').includes('—'), file).toBe(false);
});

// ─── RBAC / mapping API ──────────────────────────────────────────────────────

test('every Gestion API route and method maps to a capability (fail-closed map)', () => {
  for (const file of apiRoutes) {
    const route = '/' + relative(join(SRC, 'app'), file).split(sep).join('/').replace(/\/route\.ts$/, '')
      .replace(/\[entityType\]/, 'purchase').replace(/\[type\]/, 'full')
      .replace(/\[[^\]]+\]/g, '00000000-0000-0000-0000-000000000000');
    const methods = (readFileSync(file, 'utf8').match(/export async function (GET|POST|PATCH|DELETE)/g) ?? []).map((m) => m.split(' ').pop()!);
    for (const method of methods) expect(permissionForAdminApi(route, method), `${method} ${route}`).not.toBeNull();
  }
});

test('Gestion capabilities follow read/manage/critical semantics', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  expect(gestionApiPermission('/api/admin/gestion/suppliers', 'GET')).toBe('suppliers.view');
  expect(gestionApiPermission('/api/admin/gestion/suppliers', 'POST')).toBe('suppliers.manage');
  expect(gestionApiPermission(`/api/admin/gestion/suppliers/${id}`, 'PATCH')).toBe('suppliers.manage');
  expect(gestionApiPermission('/api/admin/gestion/purchases', 'POST')).toBe('purchases.manage');
  expect(gestionApiPermission(`/api/admin/gestion/purchases/${id}/receipts`, 'POST')).toBe('inventory.manage');
  expect(gestionApiPermission(`/api/admin/gestion/receipts/${id}/reverse`, 'POST')).toBe('inventory.manage');
  expect(gestionApiPermission('/api/admin/gestion/inventory/adjustments', 'POST')).toBe('inventory.manage');
  expect(gestionApiPermission('/api/admin/gestion/payments', 'GET')).toBe('treasury.view');
  expect(gestionApiPermission('/api/admin/gestion/payments', 'POST')).toBe('treasury.manage');
  expect(gestionApiPermission('/api/admin/gestion/export/full', 'GET')).toBe('suppliers.view');
  expect(gestionApiPermission('/api/admin/gestion/export/purchases', 'GET')).toBe('purchases.view');
  expect(gestionApiPermission('/api/admin/gestion/export/treasury', 'GET')).toBe('treasury.view');
  expect(gestionApiPermission('/api/admin/gestion/export/stock', 'GET')).toBe('inventory.view');
  expect(gestionApiPermission('/api/admin/gestion/export/stock', 'POST')).toBeNull();
  expect(gestionApiPermission(`/api/admin/gestion/payments/${id}/verify`, 'POST')).toBe('supplier_payments.verify');
  expect(gestionApiPermission(`/api/admin/gestion/payments/${id}/void`, 'POST')).toBe('treasury.manage');
  expect(gestionApiPermission(`/api/admin/gestion/allocations/${id}/reverse`, 'POST')).toBe('treasury.manage');
  expect(gestionApiPermission(`/api/admin/gestion/documents/supplier_payment/${id}`, 'POST')).toBe('treasury.manage');
  expect(gestionApiPermission(`/api/admin/gestion/documents/supplier/${id}/${id}`, 'GET')).toBe('suppliers.view');
  expect(gestionApiPermission(`/api/admin/gestion/documents/receipt/${id}/${id}`, 'DELETE')).toBe('purchases.manage');
  // Fail-closed: méthodes ou chemins inconnus.
  expect(gestionApiPermission(`/api/admin/gestion/payments/${id}/verify`, 'GET')).toBeNull();
  expect(gestionApiPermission('/api/admin/gestion/suppliers', 'DELETE')).toBeNull();
  expect(gestionApiPermission('/api/admin/gestion/unknown', 'GET')).toBeNull();
  expect(gestionApiPermission(`/api/admin/gestion/documents/tenant/${id}`, 'GET')).toBeNull();
});

test('Gestion pages require a Gestion capability; the dashboard accepts any of them', () => {
  expect(permissionsForAdminPath('/admin/gestion', 'shop')).toEqual(['suppliers.view', 'purchases.view', 'treasury.view', 'inventory.view']);
  expect(permissionsForAdminPath('/admin/gestion/fournisseurs/abc', 'shop')).toEqual(['suppliers.view']);
  expect(permissionsForAdminPath('/admin/gestion/fournisseurs/nouveau', 'shop')).toEqual(['suppliers.manage']);
  expect(permissionsForAdminPath('/admin/gestion/achats/nouveau', 'shop')).toEqual(['purchases.manage']);
  expect(permissionsForAdminPath('/admin/gestion/tresorerie', 'shop')).toEqual(['treasury.view']);
  expect(permissionsForAdminPath('/admin/gestion/tresorerie/nouveau', 'shop')).toEqual(['treasury.manage']);
});

test('tenant_admin keeps full access; custom roles only get what is assigned', () => {
  const base: AdminAccessContext = {
    userId: 'u', email: 'a@b.c', legacyRole: 'tenant_admin', tenantId: 't', roleId: 'r', roleCode: 'tenant_admin', roleName: 'Admin',
    scope: 'tenant', permissions: [], isPlatformOwner: false, profileCompleted: true, firstName: null, lastName: null, nickname: null, rbacSource: 'dynamic',
  };
  expect(canAdmin(base, 'supplier_payments.verify')).toBe(true);
  const custom = { ...base, roleCode: 'magasinier', permissions: ['purchases.view', 'inventory.manage'] };
  expect(canAdmin(custom, 'inventory.manage')).toBe(true);
  expect(canAdmin(custom, 'supplier_payments.verify')).toBe(false);
  expect(canAdmin(custom, 'treasury.view')).toBe(false);
});

// ─── Solde, affectations, vérification ────────────────────────────────────────

test('outstanding balance: the documented 2 400 € example leaves 1 000 € to pay', () => {
  const total = 2400;
  const verified = 600 + 500 + 300;
  expect(purchasePaymentState({ status: 'received', total, paid_verified: verified, paid_unverified: 0, outstanding: total - verified })).toBe('partially_paid');
  expect(total - verified).toBe(1000);
});

test('recorded but unverified payments never read as paid', () => {
  expect(purchasePaymentState({ status: 'received', total: 100, paid_verified: 0, paid_unverified: 100, outstanding: 100 })).toBe('to_verify');
  expect(purchasePaymentState({ status: 'received', total: 100, paid_verified: 100, paid_unverified: 0, outstanding: 0 })).toBe('paid');
  expect(purchasePaymentState({ status: 'ordered', total: 100, paid_verified: 0, paid_unverified: 0, outstanding: 100 })).toBe('to_pay');
  expect(purchasePaymentState({ status: 'cancelled', total: 100, paid_verified: 0, paid_unverified: 0, outstanding: 0 })).toBe('cancelled');
  // Un brouillon n'est pas une dette (migration 140) : jamais « payé » ni « à payer ».
  expect(purchasePaymentState({ status: 'draft', total: 100, paid_verified: 0, paid_unverified: 0, outstanding: 0 })).toBe('not_committed');
});

test('allocation plan validation mirrors the database rules', () => {
  const payment = { supplierId: 's1', currency: 'EUR' };
  const purchases = [
    { id: 'p1', allocatable: 1000, currency: 'EUR', supplierId: 's1', status: 'received' as const },
    { id: 'p2', allocatable: 500, currency: 'EUR', supplierId: 's1', status: 'ordered' as const },
    { id: 'p3', allocatable: 50, currency: 'EUR', supplierId: 's2', status: 'ordered' as const },
    { id: 'p4', allocatable: 50, currency: 'EUR', supplierId: 's1', status: 'cancelled' as const },
  ];
  expect(validateAllocationPlan(1500, payment, [{ purchaseId: 'p1', amount: 1000 }, { purchaseId: 'p2', amount: 500 }], purchases)).toBeNull();
  expect(validateAllocationPlan(600, payment, [{ purchaseId: 'p1', amount: 600 }], purchases)).toBeNull();
  expect(validateAllocationPlan(1500, payment, [{ purchaseId: 'p1', amount: 1100 }], purchases)).toBe('purchase_over_allocated');
  expect(validateAllocationPlan(900, payment, [{ purchaseId: 'p1', amount: 600 }, { purchaseId: 'p2', amount: 400 }], purchases)).toBe('payment_over_allocated');
  expect(validateAllocationPlan(100, payment, [{ purchaseId: 'p3', amount: 10 }], purchases)).toBe('supplier_mismatch');
  expect(validateAllocationPlan(100, payment, [{ purchaseId: 'p4', amount: 10 }], purchases)).toBe('purchase_cancelled');
  expect(validateAllocationPlan(100, payment, [{ purchaseId: 'px', amount: 10 }], purchases)).toBe('unknown_purchase');
  expect(validateAllocationPlan(100, payment, [{ purchaseId: 'p1', amount: 10 }, { purchaseId: 'p1', amount: 10 }], purchases)).toBe('duplicate_purchase');
  expect(validateAllocationPlan(100, payment, [{ purchaseId: 'p1', amount: 10.005 }], purchases)).toBe('invalid_amount');
  expect(validateAllocationPlan(100, { ...payment, currency: 'XOF' }, [{ purchaseId: 'p1', amount: 10 }], purchases)).toBe('currency_mismatch');
});

test('money amounts are positive with at most two decimals', () => {
  expect(isMoneyAmount(600)).toBe(true);
  expect(isMoneyAmount(0.1 + 0.2)).toBe(true); // bruit flottant toléré, puis arrondi par le schéma
  expect(isMoneyAmount(10.005)).toBe(false);
  expect(isMoneyAmount(10.25)).toBe(true);
  expect(isMoneyAmount(0)).toBe(false);
  expect(isMoneyAmount(-5)).toBe(false);
});

test('third-party beneficiary requires a name; the supplier stays the creditor', () => {
  const base = {
    supplier_id: '11111111-1111-4111-8111-111111111111', amount: 500, payment_date: '2026-09-19',
    method: 'bank_transfer', requestKey: 'test-request-key-001',
  };
  expect(createPaymentSchema.safeParse({ ...base, beneficiary_type: 'third_party' }).success).toBe(false);
  const parsed = createPaymentSchema.safeParse({ ...base, beneficiary_type: 'third_party', beneficiary_name: 'Transitaire' });
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data.supplier_id).toBe(base.supplier_id);
  expect(createPaymentSchema.safeParse({ ...base, amount: 10.001 }).success).toBe(false);
  const rounded = createPaymentSchema.safeParse({ ...base, amount: 0.1 + 0.2 });
  expect(rounded.success && rounded.data.amount).toBe(0.3);
});

test('a receipt must receive at least one unit and carries an idempotency key', () => {
  const item = { purchase_item_id: '11111111-1111-4111-8111-111111111111', quantity: 0 };
  expect(receiptSchema.safeParse({ items: [item], requestKey: 'receipt-key-0001' }).success).toBe(false);
  expect(receiptSchema.safeParse({ items: [{ ...item, quantity: 3 }] }).success).toBe(false);
  expect(receiptSchema.safeParse({ items: [{ ...item, quantity: 3 }], requestKey: 'receipt-key-0001' }).success).toBe(true);
});

test('partial updates never clear fields that were not sent', () => {
  expect(updatePurchaseSchema.parse({ notes: 'x' })).toEqual({ notes: 'x' });
  expect(updateSupplierSchema.parse({ active: false })).toEqual({ active: false });
  expect(updateSupplierSchema.parse({ legal_name: '' })).toEqual({ legal_name: null });
});

test('received percentage is derived from quantities', () => {
  expect(receivedPercent(20, 6)).toBe(30);
  expect(receivedPercent(14, 14)).toBe(100);
  expect(receivedPercent(0, 0)).toBe(0);
});

// ─── Références, erreurs, fichiers ────────────────────────────────────────────

test('readable references use the tenant counters format', () => {
  expect(isBusinessReference('supplier', 'FOU-000123')).toBe(true);
  expect(isBusinessReference('purchase', 'ACH-2026-000123')).toBe(true);
  expect(isBusinessReference('receipt', 'REC-2026-000001')).toBe(true);
  expect(isBusinessReference('payment', 'PAY-2026-000042')).toBe(true);
  expect(isBusinessReference('purchase', '3f2c9f8e-1111-4111-8111-111111111111')).toBe(false);
});

test('RPC errors become French messages with the right status', () => {
  expect(gestionRpcError({ message: 'purchase_over_allocated' })).toMatchObject({ status: 409, code: 'purchase_over_allocated' });
  expect(gestionRpcError({ message: 'quantity_exceeds_remaining:abc' })).toMatchObject({ status: 409 });
  expect(gestionRpcError({ message: 'duplicate key', code: '23505' })).toMatchObject({ status: 409, code: 'duplicate' });
  expect(gestionRpcError({ message: 'boom' })).toMatchObject({ status: 500, code: 'unexpected' });
  expect(gestionRpcError({ message: 'beneficiary_name_required' }).message).toContain('tiers');
});

test('attachments are typed from their bytes, never from the declared name', () => {
  expect(detectDocumentMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe('application/pdf');
  expect(detectDocumentMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  expect(detectDocumentMime(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBeNull();
  expect(safeFileName('Facture été n°12.PDF.exe', 'application/pdf')).toBe('Facture-ete-n-12.PDF.pdf');
  expect(safeFileName('../../etc/passwd', 'image/png')).toBe('passwd.png');
});
