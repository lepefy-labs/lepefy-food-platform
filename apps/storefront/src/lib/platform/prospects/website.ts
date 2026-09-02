import { CONFIG } from './config';
import { getCache, putCache, claimGate } from './repository';
import { cacheKey } from './providers';
import { safeGet, normalizeUrl, CrawlError } from './websiteFetcher';
import { robotsAllows } from './robots';
import { parseWebsite, type ParsedPage } from './websiteParser';
import type { Prospect, Signal } from './types';
export async function enrichWebsite(prospect:Prospect):Promise<Partial<Prospect>> {
  if (!prospect.website_url) return {};
  if (prospect.website_checked_at && Date.parse(prospect.website_checked_at) > Date.now()-CONFIG.websiteDays*86400000) return {};
  const key = cacheKey('website',prospect.website_url);
  const cached = await getCache<Partial<Prospect>>(key); if (cached) return cached;
  const deadline = Date.now()+40000;
  const pages:ParsedPage[] = []; let partial = false; let lastError:CrawlError | null = null;
  const robots = new Map<string,string>();
  const beforeRequest = async (url:URL) => {
    if (await getCache<boolean>('site-backoff:'+url.hostname)) throw new CrawlError('site_cooldown',429,60);
    if (!robots.has(url.origin)) {
      const robotsKey = cacheKey('robots',url.origin);
      let text = await getCache<string>(robotsKey);
      if (text === null) {
        try { text = (await safeGet(url.origin+'/robots.txt',{contentTypes:['text/plain'],maxBytes:64000,redirects:0,deadline})).body; }
        catch (e) { if (e instanceof CrawlError && e.status === 404) text = ''; else throw new CrawlError('robots_unavailable',e instanceof CrawlError ? e.status : null,e instanceof CrawlError ? e.retrySeconds : 0); }
        await putCache(robotsKey,text,86400);
      }
      robots.set(url.origin,text);
    }
    if (!robotsAllows(robots.get(url.origin) ?? '',url.pathname+url.search)) throw new CrawlError('robots_disallowed');
    if (!await claimGate('site:'+url.hostname,1)) {
      await new Promise(resolve => setTimeout(resolve,1100));
      if (!await claimGate('site:'+url.hostname,1)) throw new CrawlError('site_throttled',429,60);
    }
  };
  const patch:Partial<Prospect> = { website_checked_at:new Date().toISOString() };
  try {
    const home = await safeGet(prospect.website_url,{beforeRequest,deadline});
    if (/cf-chl-|captcha|checking your browser|verify you are human/i.test(home.body) && home.body.length < 80000) throw new CrawlError('challenge_blocked',home.status);
    const parsed = parseWebsite(home.body,home.url); pages.push(parsed);
    partial = !parsed.readable;
    for (const link of parsed.links.slice(0,2)) {
      try { const page = await safeGet(link.url,{sameOrigin:normalizeUrl(home.url).origin,beforeRequest,redirects:1,deadline});
        const next = parseWebsite(page.body,page.url); pages.push(next); if (!next.readable) partial = true;
      } catch (e) { partial = true; lastError = e instanceof CrawlError ? e : new CrawlError('request_failed'); }
    }
    patch.crawl_status = partial ? 'partial' : 'completed'; patch.crawl_http_status = home.status;
    patch.website_title = parsed.title; patch.website_description = parsed.description;
    patch.has_website = true;
  } catch (e) {
    lastError = e instanceof CrawlError ? e : new CrawlError('request_failed');
    patch.crawl_status = ['access_blocked','challenge_blocked','robots_disallowed','private_address','host_refused','url_refused'].includes(lastError.code) ? 'blocked' : 'failed';
    patch.crawl_http_status = lastError.status;
  }
  patch.crawl_error = lastError?.code ?? null;
  const observed:Signal[] = ['has_ecommerce','has_online_ordering','has_delivery','has_events','has_catering','has_loyalty','has_whatsapp_ordering'];
  for (const signal of observed) patch[signal] = pages.some(p => p.signals[signal]) ? true : patch.crawl_status === 'completed' ? false : null;
  patch.evidence = pages.flatMap(p => p.evidence).slice(0,60);
  patch.technologies = [...new Set(pages.flatMap(p => p.technologies))];
  for (const page of pages) {
    Object.assign(patch,page.social);
    if (page.emails[0] && !patch.public_email) patch.public_email = page.emails[0];
    if (page.phones[0] && !patch.phone) patch.phone = page.phones[0];
  }
  if (lastError?.retrySeconds) {
    await putCache('site-backoff:'+normalizeUrl(prospect.website_url).hostname,true,lastError.retrySeconds);
  }
  // Failed attempts are cached briefly, not for a successful-crawl refresh window.
  const ttl = patch.crawl_status === 'completed' ? CONFIG.websiteDays*86400 : CONFIG.retryMinutes*60;
  if (patch.crawl_status !== 'completed') patch.website_checked_at = null;
  await putCache(key,patch,ttl);
  return patch;
}
