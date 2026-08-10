#!/usr/bin/env bash
#
# Take a full, restorable copy of the SayNoMore database.
#
# WHY THIS EXISTS
#
# SayNoMore runs on the Supabase FREE plan (that is why .github/workflows/
# keepalive.yml exists — Free pauses a project after 7 idle days). Supabase's
# own documentation is unambiguous about what that means:
#
#   "We automatically back up all Pro, Team, and Enterprise Plan projects on a
#    daily basis."
#   "Database backups are not available for download for Free Plan projects."
#   "We recommend that free tier plan projects regularly export their data
#    using the Supabase CLI db dump command and maintain off-site backups."
#   "When you delete a project, we permanently remove all associated data,
#    including any backups stored in S3. This action is irreversible."
#
# In plain terms: today there is no copy of this business's ledger that anyone
# could restore. Every order, payment, stock movement and landed cost lives in
# exactly one place. This script is the copy Supabase tells Free users to make.
#
# WHERE THE FILE MUST NOT GO
#
# NOT into this repository. It is PUBLIC, and a dump contains every customer,
# price, margin and payment. The output path is deliberately outside the repo
# and the repo ignores it anyway. Keep the file somewhere private that is not
# the same account as the database — a backup that dies with the thing it is
# backing up is not a backup.
#
# USAGE
#
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
#   ./scripts/backup.sh                  # writes ~/saynomore-backups/<date>.sql.gz
#   ./scripts/backup.sh /path/to/dir     # or somewhere you choose
#
# Get the connection string from the Supabase dashboard:
#   Project Settings -> Database -> Connection string -> URI
# It contains the database password. Never paste it into a file in this repo.
#
# HOW TO RESTORE — tested, not assumed
#
#   gzip -dc saynomore-<stamp>.sql.gz | psql "<connection string of a NEW project>"
#
# Restore into a fresh SUPABASE project, not a bare Postgres. Both recover the
# business completely; a bare Postgres additionally prints around 57 errors for
# Supabase's own platform objects (auth/storage/realtime schemas, a publication,
# an extension) that only exist inside a Supabase project. Verified on
# 2026-08-10 by restoring a real dump into an empty database: every error was a
# missing platform schema, none touched business data, and the ledger came back
# whole — orders, order lines, stock movements and products all present with the
# right row counts.
#
# HOW OFTEN
#
# Daily is not overkill for a business whose entire ledger has no other copy.
# Run it from a machine that is on anyway, and keep the file somewhere that is
# not the Supabase account — iCloud/Drive/an external disk. If the Supabase
# account is ever lost or a project is deleted, Supabase deletes the backups
# with it, in their words "irreversible".

set -euo pipefail

OUT_DIR="${1:-$HOME/saynomore-backups}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FILE="$OUT_DIR/saynomore-$STAMP.sql.gz"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set." >&2
  echo "  Supabase dashboard -> Project Settings -> Database -> Connection string -> URI" >&2
  echo "  export SUPABASE_DB_URL='postgresql://...'" >&2
  exit 2
fi

# Refuse to write inside the repository. The dump holds every customer and
# every price; this repo is public.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ABS_OUT="$(mkdir -p "$OUT_DIR" && cd "$OUT_DIR" && pwd)"
case "$ABS_OUT" in
  "$REPO_ROOT"|"$REPO_ROOT"/*)
    echo "REFUSING: $ABS_OUT is inside the repository, which is public." >&2
    echo "A database dump contains every customer, price and payment." >&2
    exit 2 ;;
esac

echo "→ dumping to $FILE"

# The Supabase CLI is preferred and tried first. It runs pg_dump inside a
# container matching the SERVER's Postgres version, which is the whole reason it
# exists: a plain `pg_dump` from your package manager refuses outright when it is
# older than the server ("aborting because of server version mismatch"), and
# production is on Postgres 17. Falling back to local pg_dump is fine when the
# versions happen to line up, and fails loudly rather than silently when they do
# not — a backup that quietly did not happen is the worst kind.
TMP="$FILE.partial"

# The CLI may be on PATH, or only a devDependency of this repo (which is how
# SayNoMore installs it). Try both before giving up on it.
SUPA=""
if command -v supabase >/dev/null 2>&1; then SUPA="supabase"
elif [ -x "$REPO_ROOT/node_modules/.bin/supabase" ]; then SUPA="$REPO_ROOT/node_modules/.bin/supabase"
fi

if [ -n "$SUPA" ]; then
  echo "  using the Supabase CLI (matches the server's Postgres version)"
  # TWO dumps, and this matters more than it looks. `supabase db dump` defaults
  # to SCHEMA ONLY — it prints "Dumping schemas" and produces a perfectly valid
  # file containing every table definition and not one row of business. That is
  # the worst possible backup: it looks right, it restores cleanly, and the
  # ledger is empty. Caught here by the verification step below, which is the
  # entire reason that step exists.
  "$SUPA" db dump --db-url "$SUPABASE_DB_URL" -f "$TMP.schema.sql"
  "$SUPA" db dump --db-url "$SUPABASE_DB_URL" --data-only -f "$TMP.data.sql"
  cat "$TMP.schema.sql" "$TMP.data.sql" | gzip -9 > "$TMP"
  rm -f "$TMP.schema.sql" "$TMP.data.sql"
elif command -v pg_dump >/dev/null 2>&1; then
  echo "  using local pg_dump ($(pg_dump --version | awk '{print $3}'))"
  pg_dump "$SUPABASE_DB_URL" \
    --no-owner --no-privileges \
    --exclude-schema='supabase_functions' \
    --exclude-schema='extensions' \
    --exclude-schema='graphql*' \
    --exclude-schema='pgbouncer' \
    --exclude-schema='realtime' \
    --exclude-schema='storage' \
    --exclude-schema='vault' \
    | gzip -9 > "$TMP"
else
  echo "Neither the Supabase CLI nor pg_dump is installed." >&2
  echo "  npm i -g supabase   (or install postgresql-client 17+)" >&2
  exit 2
fi
mv "$TMP" "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
echo "→ wrote $SIZE"

# A dump you have never opened is a hope, not a backup. Prove it is readable
# and that it contains the tables that matter.
echo "→ verifying the file is readable, and that it holds the LEDGER not just the shape"
CORE='sales_orders|stock_movements|order_payments|inventory_batches'
SCHEMA_N=$(gzip -dc "$FILE" | grep -cE "CREATE TABLE (IF NOT EXISTS )?\"?(public)?\"?\.?\"?($CORE)\"?" || true)
# COPY blocks (or INSERTs) are the DATA. A dump with tables and no COPY is a
# schema backup wearing a backup's clothes.
DATA_N=$(gzip -dc "$FILE" | grep -cE "^(COPY|INSERT INTO) \"?(public)?\"?\.?\"?($CORE)\"?" || true)
if [ "$SCHEMA_N" -lt 4 ]; then
  echo "VERIFY FAILED: expected 4 core table definitions, found $SCHEMA_N." >&2
  echo "Do not trust this file. Check the connection string points at production." >&2
  exit 1
fi
# The LEDGER specifically: orders and stock movements. If either of those has no
# data block, the dump is worthless no matter how good it looks.
#
# Deliberately NOT requiring all four. order_payments is legitimately empty when
# nothing has been paid yet, and inventory_batches is empty before the first
# shipment lands — a check that fails on a true state is a check people learn to
# skip. This threshold was set after the verification correctly reported 3/4 on
# a database whose only order was unpaid.
LEDGER_N=$(gzip -dc "$FILE" | grep -cE "^(COPY|INSERT INTO) \"?(public)?\"?\.?\"?(sales_orders|stock_movements)\"?" || true)
if [ "$LEDGER_N" -lt 2 ]; then
  echo "VERIFY FAILED: no data for sales_orders and/or stock_movements ($LEDGER_N/2)." >&2
  echo "This looks like a SCHEMA-ONLY dump. It will restore cleanly and be empty," >&2
  echo "which is the most dangerous kind of backup there is." >&2
  exit 1
fi
echo "✓ $SCHEMA_N/4 core tables defined; ledger data present (orders + stock movements)"
echo "  data blocks across the four core tables: $DATA_N/4 (payments/batches may be legitimately empty)"

# Keep the last 14. Old copies are the ones that save you when a problem is
# only noticed a week later.
ls -1t "$OUT_DIR"/saynomore-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "✓ backup complete: $FILE"
