# Sviluppo locale riproducibile

Questa guida ricostruisce da zero un ambiente locale (database Supabase su Docker + storefront Next.js). Il database è **solo locale**: non usare mai credenziali o URL di Supabase remoto.

## Prerequisiti

- Windows 11 con WSL2 Ubuntu; il repository deve stare nel filesystem di WSL (`~/projects/lepefy-food-platform`), non in `/mnt/c`.
- Node 20 (22 o superiore solo per gli script `engineering:*`) e pnpm 8.15.0 (via `corepack enable && corepack prepare pnpm@8.15.0 --activate`).
- Docker Desktop con integrazione WSL attiva.
- Supabase CLI 2.x.
- Client PostgreSQL: `sudo apt install -y postgresql-client`.

## Supabase locale fuori dal repository

```bash
mkdir ~/supabase-local && cd ~/supabase-local
supabase init
supabase start
```

Il Supabase locale vive fuori dal repo perché `supabase db push` / `supabase db reset` non possono usare `supabase/migrations` direttamente: `supabase/` non ha `config.toml` e il prefisso numerico è duplicato in 7 coppie (006, 010, 011, 023, 031, 071, 109), più `003b` e `003c`. Le migration vengono quindi applicate con `psql`, come fa già `ci.yml`.

## Ricostruire il database

```bash
scripts/local-db-bootstrap.sh --list    # mostra l'ordine di esecuzione, non tocca nessun DB
scripts/local-db-bootstrap.sh --reset   # supabase db reset (locale) + applica tutte le migration
```

Senza `--reset` lo script lavora solo su un database vuoto e si rifiuta se trova già le tabelle del progetto. Rifiuta inoltre qualsiasi host diverso da `127.0.0.1`/`localhost` (`LOCAL_DATABASE_URL`). L'ordine è alfabetico, con l'eccezione delle due `023_*` (vedi sotto).

Le patch in `scripts/local-dev/patches/` sono fixture di sviluppo, con estensione `.pre`/`.post` (non `.sql`) perché non vengano scambiate per migration:

- `002_rls_policies.sql.post` crea il tenant `chloefood` subito dopo la 002: molte migration (003, 003b, 003c, 006, 008, 009, 011, 013, 018, 019, 020, …) lo cercano per slug. Lo slug `chloefood` è quindi una dipendenza delle migration stesse, non del codice di prodotto.
- `020_reseed_products_catalogue_v2.sql.pre` crea le 7 categorie storiche del tenant pilota (`epices`, `legumes`, `snacks`, `sauces-huiles`, `farines`, `poissons`, `viandes-sechees`); la 020 aggiunge solo `boissons`, per un totale di 8.
- `076_tenant_public_column_security.sql.pre` crea `tenants.hero_image_url` prima della 076.

## Variabili d'ambiente

```bash
cp apps/storefront/.env.local.example apps/storefront/.env.local
cd ~/supabase-local && supabase status -o env
```

Copia `ANON_KEY` e `SERVICE_ROLE_KEY` in `.env.local` (URL `http://127.0.0.1:54321`). Le chiavi attese dal codice sono in formato JWT (`eyJ…`) e l'URL è quello locale `127.0.0.1`. Se `supabase status` mostra anche chiavi `sb_publishable_…`/`sb_secret_…`, usa comunque la coppia che il codice si aspetta nel resto del progetto (JWT). Solo valori locali o di test: mai chiavi live.

## Primo utente admin

Crea un utente in Studio (`http://127.0.0.1:54323` → Authentication → Add user, con *Auto Confirm*), poi:

```sql
insert into admin_users (id, email, role, tenant_id, active)
select id, email, 'platform_owner', null, true from auth.users where lower(email) = lower('<email>');
```

## Verifiche

```bash
pnpm typecheck
pnpm lint
pnpm --filter @lepefy/storefront test:unit
```

**Non** eseguire `test:e2e`: punta a chloefood.com e crea ordini reali.

`apps/storefront/tsconfig.json` contiene `allowJs` e `noEmit` perché Next li aggiunge da solo a ogni `dev`/`build`/`lint`; senza, il file risulterebbe modificato dopo ogni comando.

## Differenze note tra repo e produzione

Debito tecnico verificato (01/11/2026), non corretto in questa guida:

1. **Tenant pilota assente**: le migration presuppongono che `chloefood` esista già prima della 003, e `supabase/seed.sql` usa colonne create più tardi (es. `google_maps_url`, migration 071), quindi non è utilizzabile su uno schema fermo alla 002.
2. **Doppia 023**: `023_label_print_jobs_drafts_reprint.sql` (originale, `create trigger` non idempotente) e `023_label_job_drafts.sql` (rinominata, con `drop trigger if exists`) sono la stessa migration; va eseguita prima l'originale.
3. **`tenants.hero_image_url`**: usata da `packages/types/tenant.ts` e dalla 076, ma nessuna migration la crea (in produzione è stata aggiunta a mano).

**Categorie**: in produzione le 7 categorie storiche erano già state create fuori dalle migration. La 020 inserisce solo "Boissons" e collega i prodotti con `select id from categories where slug = …`: senza la patch `020_reseed_products_catalogue_v2.sql.pre` quelle sottoquery restituirebbero `NULL` e la maggior parte dei prodotti resterebbe senza categoria. Con la patch il database locale ha 8 categorie e nessun prodotto senza categoria.

**Node**: gli script `engineering:*` (indice, docs-check, sync, benchmark) richiedono Node 22 o superiore, perché usano `module.registerHooks`; la CI usa Node 24. Con Node 20 falliscono con `does not provide an export named 'registerHooks'`.
