import type { SupabaseClient } from '@supabase/supabase-js';
import { pageWindow } from '@/lib/admin/listParams';

export type CampaignKind = 'promotion' | 'novelty' | 'mixed';
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'suspended' | 'ended';
export type DiscountMode = 'percent' | 'fixed' | 'custom';

export interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  kind: CampaignKind;
  status: CampaignStatus;
  discount_mode: DiscountMode | null;
  discount_value: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  promo_until_sold_out: boolean;
  novelty_starts_at: string | null;
  novelty_ends_at: string | null;
  version: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  product_count?: number;
}

export interface CampaignProduct {
  product_id: string;
  override_promo_price: number | null;
  promo_state: 'pending' | 'applied' | 'ended' | 'conflict';
  issue: string | null;
  products: {
    id: string; name: string; slug: string; price: number; compare_at_price: number | null;
    active: boolean; stock: number; min_order_quantity: number; image_url: string | null;
  } | null;
}

export interface CampaignPreviewProduct {
  id: string; name: string; active: boolean; stock: number; min_order_quantity: number;
  regular_price: number; promo_price: number | null; issue: string | null;
}

export interface CampaignPreview {
  version: number;
  status: CampaignStatus;
  count: number;
  blocked: number;
  page: number;
  size: number;
  products: CampaignPreviewProduct[];
}

export const CAMPAIGN_KIND_LABEL: Record<CampaignKind, string> = {
  promotion: 'Promotion', novelty: 'Nouveautés', mixed: 'Promotion + Nouveautés',
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Brouillon', scheduled: 'Programmée', running: 'En cours',
  suspended: 'Suspendue', ended: 'Terminée',
};

const STATUS = new Set<CampaignStatus>(['draft','scheduled','running','suspended','ended']);
const KIND = new Set<CampaignKind>(['promotion','novelty','mixed']);
const MODE = new Set<DiscountMode>(['percent','fixed','custom']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }

export function campaignActionAllowed(status: CampaignStatus, action: string): boolean {
  return (action === 'publish' && status === 'draft')
    || (action === 'resume' && status === 'suspended')
    || (action === 'suspend' && (status === 'scheduled' || status === 'running'))
    || (action === 'end' && (status === 'scheduled' || status === 'running' || status === 'suspended'));
}

export function parseCampaignConfig(raw: unknown): { ok: true; value: Omit<Campaign,
  'id' | 'tenant_id' | 'status' | 'version' | 'last_error' | 'created_at' | 'updated_at' | 'product_count'> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Configuration invalide.' };
  const r = raw as Record<string, unknown>;
  const name = String(r.name ?? '').trim();
  if (!name || name.length > 160) return { ok: false, error: 'Indiquez un nom de campagne (160 caractères maximum).' };
  if (!KIND.has(r.kind as CampaignKind)) return { ok: false, error: 'Choisissez un type de campagne.' };
  const kind = r.kind as CampaignKind;
  const discountMode = kind === 'novelty' ? null : r.discount_mode as DiscountMode;
  if (discountMode !== null && !MODE.has(discountMode)) return { ok: false, error: 'Choisissez une règle de réduction.' };
  const discountValue = discountMode === 'custom' || discountMode === null ? null : Number(r.discount_value);
  if (discountMode === 'percent' && (!Number.isFinite(discountValue) || discountValue! <= 0 || discountValue! >= 100))
    return { ok: false, error: 'La réduction doit être comprise entre 0 et 100 %.' };
  if (discountMode === 'fixed' && (!Number.isFinite(discountValue) || discountValue! <= 0))
    return { ok: false, error: 'La réduction en euros doit être positive.' };
  const date = (value: unknown): string | null | false => {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    return new Date(value).toISOString();
  };
  const promoStart = date(r.promo_starts_at);
  const promoEnd = date(r.promo_ends_at);
  const noveltyStart = date(r.novelty_starts_at);
  const noveltyEnd = date(r.novelty_ends_at);
  if ([promoStart,promoEnd,noveltyStart,noveltyEnd].includes(false)) return { ok: false, error: 'Date invalide.' };
  if (kind !== 'novelty' && promoStart && promoEnd && Date.parse(promoEnd) <= Date.parse(promoStart))
    return { ok: false, error: 'La fin de la promotion doit suivre son début.' };
  if (kind !== 'promotion' && (!noveltyEnd || (noveltyStart && Date.parse(noveltyEnd) <= Date.parse(noveltyStart))))
    return { ok: false, error: 'Choisissez une fin de nouveauté après son début.' };
  return { ok: true, value: {
    name, kind, description: String(r.description ?? '').trim().slice(0, 2000) || null,
    discount_mode: discountMode, discount_value: discountValue,
    promo_starts_at: kind === 'novelty' ? null : promoStart || null,
    promo_ends_at: kind === 'novelty' ? null : promoEnd || null,
    promo_until_sold_out: kind !== 'novelty' && r.promo_until_sold_out === true,
    novelty_starts_at: kind === 'promotion' ? null : noveltyStart || null,
    novelty_ends_at: kind === 'promotion' ? null : noveltyEnd || null,
  } };
}

export interface CampaignListFilters {
  q: string; kind: string; status: string; sort: string; page: number; size: number;
}

export function parseCampaignList(raw: URLSearchParams | Record<string,string|string[]|undefined>): CampaignListFilters {
  const get = (key: string) => raw instanceof URLSearchParams ? raw.get(key) : (Array.isArray(raw[key]) ? raw[key][0] : raw[key]) ?? null;
  const kind = get('kind') ?? '';
  const status = get('status') ?? '';
  const sort = get('sort') ?? '';
  return {
    q: (get('q') ?? '').trim().replace(/[%_,()]/g, ' ').slice(0,80),
    kind: KIND.has(kind as CampaignKind) ? kind : '',
    status: STATUS.has(status as CampaignStatus) ? status : '',
    sort: ['created_desc','name_asc','start_asc','start_desc'].includes(sort) ? sort : 'created_desc',
    page: Math.max(1,Math.min(10000,Number.parseInt(get('page') ?? '1',10) || 1)),
    size: [25,50,100].includes(Number(get('size'))) ? Number(get('size')) : 25,
  };
}

export async function loadCampaignList(db: SupabaseClient, tenantId: string, f: CampaignListFilters) {
  let query = db.from('catalog_campaigns')
    .select('*, catalog_campaign_products(count)', { count: 'exact' }).eq('tenant_id',tenantId);
  if (f.q) query = query.ilike('name',`%${f.q}%`);
  if (f.kind) query = query.eq('kind',f.kind);
  if (f.status) query = query.eq('status',f.status);
  const sort = f.sort === 'name_asc' ? { column: 'name', ascending: true }
    : f.sort === 'start_asc' ? { column: 'starts_at_sort', ascending: true }
      : f.sort === 'start_desc' ? { column: 'starts_at_sort', ascending: false }
        : { column: 'created_at', ascending: false };
  const from = (f.page-1)*f.size;
  const { data,count,error } = await query.order(sort.column,{ ascending:sort.ascending })
    .order('id',{ ascending:true }).range(from,from+f.size-1);
  if (error) throw error;
  const total = count ?? 0;
  return { campaigns: (data ?? []).map((row: any) => ({ ...row, product_count: row.catalog_campaign_products?.[0]?.count ?? 0 })) as Campaign[],
    window: pageWindow(total,f.page,f.size), total };
}

export async function loadCampaign(db: SupabaseClient, tenantId: string, id: string, selectedPage = 1) {
  const { data: campaign,error } = await db.from('catalog_campaigns').select('*')
    .eq('tenant_id',tenantId).eq('id',id).maybeSingle();
  if (error) throw error;
  if (!campaign) return null;
  const page = Math.max(1,Math.min(10000,selectedPage));
  const { data: products,count,error: productError } = await db.from('catalog_campaign_products')
    .select('product_id,override_promo_price,promo_state,issue,products(id,name,slug,price,compare_at_price,active,stock,min_order_quantity,image_url)',{ count:'exact' })
    .eq('tenant_id',tenantId).eq('campaign_id',id).order('added_at').order('product_id')
    .range((page-1)*100,page*100-1);
  if (productError) throw productError;
  return { campaign: { ...campaign,product_count:count ?? 0 } as Campaign,
    products: (products ?? []) as unknown as CampaignProduct[] };
}
