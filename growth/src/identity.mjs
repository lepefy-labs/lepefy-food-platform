// Identità aziendale: chiavi forti (dominio, profilo social, telefono, P.IVA)
// e chiave debole (nome + città). Nessuna dipendenza, funzioni pure.

const GENERIC_HOSTS = [
  'facebook.com', 'instagram.com', 'tiktok.com', 'wa.me', 'whatsapp.com', 'linktr.ee', 'google.com',
  'goo.gl', 'youtube.com', 'linkedin.com', 'x.com', 'twitter.com', 'tripadvisor.it', 'justeat.it',
  'glovoapp.com', 'odoo.com', 'webador.it', 'myshopify.com', 'wixsite.com',
];

const NAME_STOP = new Set([
  'di', 'de', 'del', 'della', 'dei', 'la', 'il', 'lo', 'le', 'e', 'and', 'the', 'ex', 'c',
  'srl', 'srls', 'snc', 'sas', 'spa', 'sarl', 'ltd',
]);

export function normText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/&/g, ' e ')
    .replace(/s\.?r\.?l\.?s?\b|s\.?n\.?c\.?\b|s\.?a\.?s\.?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Chiave nome compatta: "Afro World" e "AfroWorld" coincidono. */
export function nameKey(name) {
  return normText(name).split(' ').filter((t) => t && !NAME_STOP.has(t)).join('');
}

export function cityKey(city) {
  return normText(city).replace(/\bnell?\b/g, ' ').replace(/\s+/g, '');
}

export function domainOf(url) {
  try {
    const host = new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '');
    return host;
  } catch { return null; }
}

function isGeneric(host) {
  return GENERIC_HOSTS.some((g) => host === g || host.endsWith(`.${g}`));
}

function socialKey(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|it-it)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'facebook.com') {
    const id = u.searchParams.get('id');
    if (id) return `fb:${id}`;
    if (parts[0] === 'p' && parts[1]) return `fb:${(parts[1].match(/(\d{6,})$/)?.[1] ?? parts[1]).toLowerCase()}`;
    if (parts[0] && !['profile.php', 'groups', 'sharer', 'pages'].includes(parts[0])) return `fb:${parts[0].toLowerCase()}`;
    return null;
  }
  if (host === 'instagram.com' && parts[0] && !['p', 'reel', 'explore'].includes(parts[0])) return `ig:${parts[0].toLowerCase()}`;
  return null;
}

export function phoneKey(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  digits = digits.replace(/^00/, '');
  if (digits.length > 10 && digits.startsWith('39')) digits = digits.slice(2);
  // +33 6 12 34 56 78 e 06 12 34 56 78 sono lo stesso numero francese.
  else if (digits.length === 11 && digits.startsWith('33')) digits = `0${digits.slice(2)}`;
  return digits.length >= 8 ? `tel:${digits}` : null;
}

/** Via + civico normalizzati, per distinguere due attività omonime nella stessa città. */
export function addressKey(address) {
  const t = normText(address).replace(/\b(via|viale|v le|piazza|corso|strada|largo|vicolo|dei|delle|degli|g|o)\b/g, ' ');
  const number = t.match(/\b(\d{1,4})\b/)?.[1] ?? '';
  const street = t.replace(/\b\d+\w?\b/g, ' ').split(' ').filter((x) => x.length > 2)[0] ?? '';
  return street ? `${street}${number}` : null;
}

export function identityKeys(d) {
  const strong = new Set();
  const links = d.links ?? {};
  const urls = [links.website, links.facebook, links.instagram, ...(links.other ?? [])].filter(Boolean);
  for (const url of urls) {
    const social = socialKey(url);
    if (social) { strong.add(social); continue; }
    const host = domainOf(url);
    if (host && !isGeneric(host)) strong.add(`dom:${host}`);
  }
  for (const phone of d.phones ?? []) { const k = phoneKey(phone); if (k) strong.add(k); }
  if (d.vat) strong.add(`vat:${String(d.vat).replace(/\D/g, '')}`);
  const city = cityKey(d.city);
  const names = [d.name, ...(d.aliases ?? [])].map(nameKey).filter((n) => n.length >= 4);
  const weak = new Set(names.map((n) => `name:${n}@${city}`));
  return { strong: [...strong], weak: [...weak], address: addressKey(d.address) };
}

/**
 * 'same'      stessa azienda (chiave forte condivisa, oppure nome+città senza indirizzi in conflitto)
 * 'possible'  nome+città coincidono ma gli indirizzi differiscono: non si fonde, si segnala
 * 'different'
 */
export function compareIdentity(a, b) {
  const ka = identityKeys(a); const kb = identityKeys(b);
  if (ka.strong.some((k) => kb.strong.includes(k))) return 'same';
  if (ka.weak.some((k) => kb.weak.includes(k))) {
    if (ka.address && kb.address && ka.address !== kb.address) return 'possible';
    return 'same';
  }
  return 'different';
}

export function slugId(d) {
  return `${normText(d.name).replace(/ /g, '-')}--${normText(d.city).replace(/ /g, '-')}`.slice(0, 80);
}
