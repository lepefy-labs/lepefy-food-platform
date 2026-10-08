/**
 * Hook di risoluzione per eseguire script TypeScript locali con il type
 * stripping nativo di Node (>= 23.6 / 22.18), senza nuove dipendenze (tsx…).
 *
 * I moduli in src/ importano senza estensione (`./types`), come il resto del
 * repo: Node ESM richiede invece l'estensione. Questo hook riprova con `.ts`
 * soltanto per specificatori relativi/assoluti/file: senza estensione.
 *
 *   node --import ./scripts/ts-resolve-hooks.mjs scripts/<script>.ts
 */
import { registerHooks } from 'node:module';

const LOCAL = /^(\.{1,2}\/|\/|file:|[A-Za-z]:[\\/])/;
const HAS_EXT = /\.[cm]?[jt]sx?$|\.json$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (LOCAL.test(specifier) && !HAS_EXT.test(specifier)) {
        try {
          return nextResolve(`${specifier}.ts`, context);
        } catch {
          return nextResolve(`${specifier.replace(/\/$/, '')}/index.ts`, context); // import di cartella
        }
      }
      throw err;
    }
  },
});
