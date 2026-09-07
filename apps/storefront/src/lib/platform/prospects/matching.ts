import type { Identity } from './types';
export function businessTokens(value:string):string[] {
  const words = value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  // Strip only legal forms at the edges, never commercial descriptors.
  const legal = new Set(['sas','sasu','sarl','eurl','sa','snc','sci']);
  while (words.length > 1 && legal.has(words[0]!)) words.shift();
  while (words.length > 1 && legal.has(words[words.length-1]!)) words.pop();
  return words;
}
export function nameSimilarity(a:string,b:string):number {
  const aa=businessTokens(a), bb=businessTokens(b);
  if (!aa.length || !bb.length) return 0;
  if (aa.join(' ') === bb.join(' ')) return 1;
  const x=new Set(aa), y=new Set(bb), overlap=[...x].filter(t=>y.has(t)).length;
  const jaccard=overlap/new Set([...x,...y]).size;
  // At least two shared tokens for containment: one generic word is not identity.
  return Math.max(jaccard,overlap>=2 && overlap===Math.min(x.size,y.size) ? 0.9 : 0);
}
export type BusinessCandidate = {
  id:string; names:string[]; siret?:string; postalCode?:string; city?:string; address?:string;
  latitude?:number; longitude?:number; food?:boolean;
};
export type MatchResult<T> = {
  matched:boolean; confidence:number; reasons:string[]; ambiguous:boolean; candidate:T | null;
};
const normalized=(s:string)=>businessTokens(s).join(' ');
export function businessConfidence(p:Identity,c:BusinessCandidate) {
  const reasons:string[]=[];
  if (p.siret && c.siret) return c.siret===p.siret
    ? {confidence:100,reasons:['SIRET exact']} : {confidence:0,reasons:['SIRET différent']};
  const name=Math.max(...[p.business_name,p.legal_name ?? ''].flatMap(a=>c.names.map(b=>nameSimilarity(a,b))),0);
  if (name<0.65) return {confidence:0,reasons:['Nom insuffisamment similaire']};
  reasons.push('Similarité du nom '+Math.round(name*100)+'%');
  if (c.food===false) return {confidence:0,reasons:[...reasons,'Activité incompatible']};
  if (p.postal_code && c.postalCode && p.postal_code!==c.postalCode) return {confidence:0,reasons:[...reasons,'Code postal différent']};
  let distance:number | null=null;
  if ([p.latitude,p.longitude,c.latitude,c.longitude].every(v=>typeof v==='number' && Number.isFinite(v))) {
    distance=Math.hypot((c.latitude!-p.latitude!)*111000,(c.longitude!-p.longitude!)*111000*Math.cos(p.latitude!*Math.PI/180));
    if (distance>200) return {confidence:0,reasons:[...reasons,'Distance supérieure à 200 m']};
    reasons.push('Distance '+Math.round(distance)+' m');
  }
  const postcode=Boolean(p.postal_code && p.postal_code===c.postalCode);
  const address=Boolean(p.address && c.address && normalized(p.address)===normalized(c.address));
  const house=(s?:string | null)=>s?.match(/^\s*(\d+[a-z]?)(?:\s|$)/i)?.[1]?.toLowerCase();
  if (house(p.address) && house(c.address) && house(p.address)!==house(c.address))
    return {confidence:0,reasons:[...reasons,'Numéro de rue différent']};
  if (p.city && c.city && normalized(p.city)!==normalized(c.city)) return {confidence:0,reasons:[...reasons,'Ville différente']};
  // No automatic match on name or proximity alone.
  let confidence=Math.round(name*55);
  if (distance!==null) confidence+=distance<=50 ? 25 : distance<=100 ? 20 : 10;
  if (postcode) {confidence+=10;reasons.push('Même code postal');}
  if (address) {confidence+=20;reasons.push('Même adresse');}
  if (c.food===true) {confidence+=10;reasons.push('Activité alimentaire compatible');}
  if (distance===null && !(address && postcode)) confidence=Math.min(confidence,74);
  return {confidence:Math.min(99,confidence),reasons};
}
export function matchBusiness<T>(p:Identity,items:T[],candidate:(item:T)=>BusinessCandidate):MatchResult<T> {
  const ranked=items.map(item=>({item,...businessConfidence(p,candidate(item))})).sort((a,b)=>b.confidence-a.confidence);
  const best=ranked[0], runner=ranked[1];
  const ambiguous=Boolean(best && best.confidence>=65 && runner && runner.confidence>=65 && best.confidence-runner.confidence<12);
  return {matched:Boolean(best && best.confidence>=85 && !ambiguous),confidence:best?.confidence ?? 0,
    reasons:[...(best?.reasons ?? ['Aucun résultat']),...(ambiguous ? ['Plusieurs candidats proches en confiance'] : [])],
    ambiguous,candidate:best && best.confidence>=65 ? best.item : null};
}
