import { getCache, putCache, claimGate, hash } from './repository';
import { safeGet, CrawlError } from './websiteFetcher';
export async function providerJson<T>(url:string,provider:string,spacing:number):Promise<T> {
  const cooldown = await getCache<boolean>('backoff:'+provider);
  if (cooldown) throw new CrawlError('source_cooldown',429,60);
  if (!await claimGate('provider:'+provider,spacing)) throw new CrawlError('source_throttled',429,spacing);
  try {
    const page = await safeGet(url,{contentTypes:['application/json'],maxBytes:2_000_000,redirects:0});
    return JSON.parse(page.body) as T;
  } catch (e) {
    if (e instanceof CrawlError && e.retrySeconds) await putCache('backoff:'+provider,true,e.retrySeconds);
    throw e;
  }
}
export const cacheKey = (provider:string,value:unknown) => provider+':'+hash(value);
