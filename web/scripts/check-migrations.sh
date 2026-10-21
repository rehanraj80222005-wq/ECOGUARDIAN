#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE=postgres:17-alpine
SERVER="ecoguardian-migrations-$$"

files=(
  supabase/001-emission-records.sql
  supabase/source-documents.sql
  supabase/source-linked-records.sql
  supabase/billing-dates.sql
  supabase/billing-date-corrections.sql
  supabase/restrict-legacy-emission-save.sql
  supabase/restrict-direct-emission-inserts.sql
  supabase/summary.sql
  supabase/monthly-emissions.sql
  supabase/review-summary.sql
  supabase/ai-request-limits.sql
  supabase/source-document-kinds.sql
  supabase/classify-source-documents.sql
  supabase/guard-source-activity-kind.sql
)

for file in "${files[@]}"; do
  if [ ! -s "$file" ]; then
    echo "Missing or empty migration: $file"
    exit 1
  fi
done

if [ "${#files[@]}" -ne 14 ]; then
  echo "Expected 14 migrations; found ${#files[@]}."
  exit 1
fi

# No published ports or container-to-container networking.
docker run -d --rm \
  --name "$SERVER" \
  --network none \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=temporary-local-test-only \
  "$IMAGE" >/dev/null

cleanup() {
  docker rm -f "$SERVER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ready=false

for attempt in $(seq 1 45); do
  if docker exec "$SERVER" \
    pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != true ]; then
  docker logs "$SERVER"
  exit 1
fi

echo "Creating minimal Auth dependencies for this isolated test."

docker exec -i "$SERVER" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;

create schema auth;

-- Dependency stub only, not a complete Supabase Auth table.
create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(
      current_setting('request.jwt.claims', true), ''
    )::jsonb ->> 'sub'
  )::uuid;
$$;

grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
SQL

for file in "${files[@]}"; do
  echo "Applying: $(basename "$file")"

  docker exec -i "$SERVER" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
    < "$file"
done

echo "PASS: all 14 migrations executed in order on fresh PostgreSQL."

echo "Running database behavior tests."

docker exec -i "$SERVER" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/behavior.sql

echo "PASS: database behavior tests completed."
echo "Running monthly emissions tests."

docker exec -i "$SERVER" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/monthly-emissions.sql

echo "PASS: monthly emissions tests completed."
echo "Scope: minimal Auth simulation; not a full Supabase stack test."