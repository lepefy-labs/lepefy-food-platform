import type { Evidence, Signal } from './types';
export type ParsedPage = {
  title:string | null; description:string | null; emails:string[]; phones:string[];
  social:Partial<Record<'instagram_url'|'facebook_url'|'tiktok_url'|'whatsapp_url',string>>;
  links:{ url:string; rank:number }[]; signals:Partial<Record<Signal,boolean>>;
  technologies:string[]; evidence:Evidence[]; readable:boolean;
};
export function decodeHtml(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#39|#x[0-9a-f]+|#\d+);/gi, token => {
    const known:Record<string,string> = { '&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' ' };
    if (known[token.toLowerCase()]) return known[token.toLowerCase()];
    const n = token[2].toLowerCase() === 'x' ? parseInt(token.slice(3,-1),16) : parseInt(token.slice(2,-1),10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
export function attributes(tag: string): Record<string,string> {
  const result:Record<string,string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}
const plain = (s:string) => decodeHtml(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
export function publicLink(input: string, base?: string): string | null {
  try { const u = new URL(input,base); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = ''; return u.href.length <= 2048 ? u.href : null; } catch { return null; }
}
export function socialLink(input: string): keyof ParsedPage['social'] | null {
  try {
    const u = new URL(input), host = u.hostname.replace(/^www\./,'').toLowerCase();
    if (/\/(share|sharer|intent|login|dialog)(\/|\.|$)/i.test(u.pathname)) return null;
    if (host === 'wa.me' || (host === 'api.whatsapp.com' && u.pathname === '/send')) return 'whatsapp_url';
    if (!u.pathname || u.pathname === '/') return null;
    return host === 'instagram.com' ? 'instagram_url' : host === 'facebook.com' ? 'facebook_url' : host === 'tiktok.com' ? 'tiktok_url' : null;
  } catch { return null; }
}
export function parseWebsite(html: string, pageUrl: string): ParsedPage {
  const clean = html.replace(/<!--[\s\S]*?-->/g,'');
  const visible = plain(clean.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
  const p:ParsedPage = { title:plain(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0,300) || null,
    description:null, emails:[], phones:[], social:{}, links:[], signals:{}, technologies:[], evidence:[], readable:visible.length >= 80 };
  const mark = (signal:Signal, value:string) => { p.signals[signal] = true; p.evidence.push({ signal, source:pageUrl, value:value.slice(0,180) }); };
  for (const meta of clean.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(meta[0]);
    if (a.name?.toLowerCase() === 'description') p.description = a.content?.slice(0,500) ?? null;
  }
  // Only role/business mailboxes from public pages; do not harvest named people.
  const email = (value:string) => {
    const matches = decodeHtml(value).match(/[a-z0-9.!#$%&'*+/=?^_~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    for (const m of matches) if (/^(contact|info|bonjour|hello|commande|commandes|reservation|reservations|accueil|commercial|vente|ventes|shop|boutique|traiteur|service|support)@/i.test(m)) p.emails.push(m.toLowerCase());
  };
  const phone = (value:string) => { const v = value.replace(/[^\d+]/g,''); if (/^\+?\d{9,15}$/.test(v)) p.phones.push(v); };
  email(visible);
  for (const match of visible.matchAll(/(?:\+33|0033|0)[1-9](?:[\s.\-]?\d{2}){4}/g)) phone(match[0]);
  const links = new Map<string,number>();
  for (const match of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attributes(match[1]); if (!a.href) continue;
    if (/^mailto:/i.test(a.href)) { email(a.href); continue; }
    if (/^tel:/i.test(a.href)) { phone(a.href); continue; }
    const link = publicLink(a.href,pageUrl); if (!link) continue;
    const key = socialLink(link); if (key) p.social[key] = link;
    const u = new URL(link); const label = (decodeURIComponentSafe(u.pathname)+' '+plain(match[2])).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if (!key && /\b(commander|commande|order|checkout|panier|cart)\b/.test(label)) mark('has_online_ordering',label);
    if (u.origin !== new URL(pageUrl).origin || /\.(pdf|jpe?g|png|gif|webp|svg|mp4|mp3|zip|xml|css|js)$/i.test(u.pathname)) continue;
    if (/mentions|confidentialite|privacy|legal|conditions|logout/.test(label)) continue;
    const rank = /contact/.test(label) ? 100 : /boutique|shop|store|commande|order/.test(label) ? 90
      : /livraison|delivery/.test(label) ? 80 : /traiteur|catering/.test(label) ? 70 : /evenement|event/.test(label) ? 60 : /fidelite|loyalty/.test(label) ? 50 : 0;
    if (rank && u.href !== pageUrl) links.set(u.href,Math.max(links.get(u.href) ?? 0,rank));
  }
  const tech: [string,RegExp,boolean][] = [
    ['Shopify',/cdn\.shopify\.com|Shopify\.shop\s*=/i,true],
    ['WooCommerce',/wp-content\/plugins\/woocommerce|woocommerce-(?:cart|product)/i,true],
    ['PrestaShop',/prestashop(?:\.| =)|name=["']generator["'][^>]*PrestaShop/i,true],
    ['Wix',/static\.wixstatic\.com|wix-site/i,false],
    ['Squarespace',/static\d*\.squarespace\.com|squarespace-cdn\.com/i,false],
  ];
  for (const [name,pattern,commerce] of tech) if (pattern.test(clean)) { p.technologies.push(name); if (commerce) mark('has_ecommerce',name+' assets'); }
  const normalized = visible.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  for (const [signal,pattern] of [
    ['has_delivery',/\b(livraison|delivery)\b/],['has_catering',/\b(traiteur|catering)\b/],
    ['has_events',/\b(evenements?|events?)\b/],['has_loyalty',/\b(fidelite|loyalty)\b/],
  ] as [Signal,RegExp][]) {
    const match = pattern.exec(normalized);
    if (match && !/\b(pas de|sans|no|not)\s*$/.test(normalized.slice(Math.max(0,match.index-20),match.index))) mark(signal,visible.slice(Math.max(0,match.index-30),match.index+100));
  }
  for (const script of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(script[1]).type?.toLowerCase() !== 'application/ld+json' || script[2].length > 100000) continue;
    try {
      const visit = (obj:unknown,depth=0) => {
        if (depth > 8 || !obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.slice(0,100).forEach(v => visit(v,depth+1)); return; }
        const o = obj as Record<string,unknown>, types = Array.isArray(o['@type']) ? o['@type'] : [o['@type']];
        if (types.some(t => typeof t === 'string' && /^(LocalBusiness|Store|GroceryStore|FoodEstablishment|Restaurant|Bakery|ButcherShop|Caterer)$/.test(t))) {
          if (typeof o.email === 'string') email(o.email);
          if (typeof o.telephone === 'string') phone(o.telephone);
          const sameAs = Array.isArray(o.sameAs) ? o.sameAs : [o.sameAs];
          for (const url of sameAs) if (typeof url === 'string') { const link = publicLink(url); const key = link && socialLink(link); if (key && link) p.social[key] = link; }
          if (types.includes('Caterer')) mark('has_catering','JSON-LD Caterer');
        }
        if (types.includes('Product') && o.offers) mark('has_ecommerce','JSON-LD Product with offers');
        if (types.includes('Event')) mark('has_events','JSON-LD Event');
        for (const value of Object.values(o).slice(0,100)) if (typeof value === 'object') visit(value,depth+1);
      };
      visit(JSON.parse(script[2]));
    } catch { /* Invalid JSON-LD is not evidence. */ }
  }
  if (p.social.instagram_url) mark('has_instagram',p.social.instagram_url);
  if (p.social.facebook_url) mark('has_facebook',p.social.facebook_url);
  if (p.social.tiktok_url) mark('has_tiktok',p.social.tiktok_url);
  if (p.social.whatsapp_url && /\b(commander|commande|order)\b.{0,40}whatsapp|whatsapp.{0,40}\b(commander|commande|order)\b/i.test(normalized)) mark('has_whatsapp_ordering','Commande via WhatsApp');
  p.emails = [...new Set(p.emails)].slice(0,3); p.phones = [...new Set(p.phones)].slice(0,3);
  p.links = [...links].map(([url,rank]) => ({url,rank})).sort((a,b) => b.rank-a.rank || a.url.localeCompare(b.url)).slice(0,10);
  p.evidence = p.evidence.slice(0,30);
  return p;
}
function decodeURIComponentSafe(s:string) { try { return decodeURIComponent(s); } catch { return s; } }
