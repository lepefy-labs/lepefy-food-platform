// Same search as the loyalty section, mounted under /api/admin/ambassador so it
// carries the growth.manage permission of this page (adminApiPermissions.ts).
export { GET } from '../../loyalty/customers-search/route';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
