import type { Prospect } from './types';
export type BusinessLookupResult = { patch:Partial<Prospect>; transientWebsite?:string; status:string };
export interface BusinessLookupProvider {
  name:string;
  lookup(prospect:Prospect):Promise<BusinessLookupResult>;
}
