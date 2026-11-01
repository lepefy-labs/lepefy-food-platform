#!/usr/bin/env bash
# Ricostruisce il database LOCALE (Supabase CLI su Docker) applicando da zero tutte le
# migration di supabase/migrations, piu' le patch di scripts/local-dev/patches/.
# Vedi docs/LOCAL_DEVELOPMENT.md. Mai contro un database remoto: lo script lo rifiuta.
#
# Uso:
#   scripts/local-db-bootstrap.sh --list     # mostra l'ordine di esecuzione, non tocca nessun DB
#   scripts/local-db-bootstrap.sh --reset    # supabase db reset (DB locale) + applica tutto
#   scripts/local-db-bootstrap.sh            # applica tutto su un DB locale vuoto
#
# Variabili (opzionali):
#   LOCAL_DATABASE_URL   default postgresql://postgres:postgres@127.0.0.1:54322/postgres
#   SUPABASE_LOCAL_DIR   cartella dove e' stato fatto `supabase init` (default ~/supabase-local)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
PATCHES_DIR="$REPO_ROOT/scripts/local-dev/patches"
PGURL="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
SUPABASE_LOCAL_DIR="${SUPABASE_LOCAL_DIR:-$HOME/supabase-local}"

MODE="apply"
for arg in "$@"; do
  case "$arg" in
    --list)  MODE="list" ;;
    --reset) MODE="reset" ;;
    -h|--help) sed -n 2,14p "$0"; exit 0 ;;
    *) echo "Opzione sconosciuta: $arg" >&2; exit 2 ;;
  esac
done

# Ordine di esecuzione: alfabetico (LC_ALL=C), con una eccezione nota.
# I due file 023_* sono la stessa migration in due versioni: l'originale
# (023_label_print_jobs_drafts_reprint.sql) va prima di quella rinominata e idempotente
# (023_label_job_drafts.sql), altrimenti "create trigger" fallisce perche' esiste gia'.
ordered_files() {
  find "$MIGRATIONS_DIR/" -maxdepth 1 -name '*.sql' -printf '%f\n' | LC_ALL=C sort | awk '
    $0=="023_label_job_drafts.sql" { held=$0; next }
    $0=="023_label_print_jobs_drafts_reprint.sql" { print; if (held != "") { print held; held="" }; next }
    { print }
    END { if (held != "") print held }'
}

if [ "$MODE" = "list" ]; then
  while IFS= read -r f; do
    [ -f "$PATCHES_DIR/$f.pre" ]  && echo "  patch(pre)   $f.pre"
    echo "$f"
    [ -f "$PATCHES_DIR/$f.post" ] && echo "  patch(post)  $f.post"
  done < <(ordered_files)
  exit 0
fi

# Protezione: solo database locale.
DB_HOST="$(printf '%s' "$PGURL" | sed -E 's#^[a-z]+://[^@]*@##; s#[:/?].*$##')"
case "$DB_HOST" in
  127.0.0.1|localhost) ;;
  *) echo "RIFIUTATO: l'host del database e' '$DB_HOST'. Questo script funziona solo su 127.0.0.1/localhost." >&2; exit 1 ;;
esac

command -v psql >/dev/null || { echo "psql non trovato (sudo apt install -y postgresql-client)" >&2; exit 1; }

if [ "$MODE" = "reset" ]; then
  command -v supabase >/dev/null || { echo "Supabase CLI non trovata" >&2; exit 1; }
  [ -d "$SUPABASE_LOCAL_DIR" ] || { echo "Cartella $SUPABASE_LOCAL_DIR inesistente (supabase init + supabase start)" >&2; exit 1; }
  (cd "$SUPABASE_LOCAL_DIR" && supabase db reset)
fi

if [ -n "$(psql "$PGURL" -tAc "select to_regclass('public.tenants')" 2>/dev/null || true)" ]; then
  echo "Il database contiene gia' le tabelle del progetto. Rilancia con --reset per ripartire da zero." >&2
  exit 1
fi

run_sql() { psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$1"; }

while IFS= read -r f; do
  if [ -f "$PATCHES_DIR/$f.pre" ]; then
    echo "  patch(pre)  $f.pre"; run_sql "$PATCHES_DIR/$f.pre" || { echo "PATCH FALLITA: $f.pre" >&2; exit 1; }
  fi
  echo ">> $f"
  run_sql "$MIGRATIONS_DIR/$f" || { echo "MIGRATION FALLITA: $f" >&2; exit 1; }
  if [ -f "$PATCHES_DIR/$f.post" ]; then
    echo "  patch(post) $f.post"; run_sql "$PATCHES_DIR/$f.post" || { echo "PATCH FALLITA: $f.post" >&2; exit 1; }
  fi
done < <(ordered_files)

echo "OK: tutte le migration applicate."
psql "$PGURL" -c "select (select count(*) from tenants) as tenants, (select count(*) from products) as products, (select count(*) from categories) as categories;"
