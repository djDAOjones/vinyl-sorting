#!/usr/bin/env bash
# Deep Groove — first deployment.
#
# Everything here needs a Cloudflare account, which is why it is a
# script for the maintainer to run rather than something already done.
# Run `npx wrangler login` first; this script refuses to start without
# it rather than dropping you into a browser prompt mid-way.
#
# Idempotent: re-running skips resources that already exist, so a
# failure halfway through is fixed by running it again.
#
# It deliberately does NOT touch DISCOGS_TOKEN. Storing a credential is
# yours to do, and the command is printed at the end.

set -euo pipefail
cd "$(dirname "$0")/.."

export CI=true WRANGLER_SEND_METRICS=false
w() { npx wrangler "$@" </dev/null; }

say() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

say "Checking you are logged in"
# Test for the failure string, not for the word "account": wrangler's
# logged-out message mentions a "temporary preview account", so
# grepping for "account" reports success when you are logged out.
if w whoami 2>&1 | grep -qi 'not authenticated'; then
  echo "Not logged in. Run:  npx wrangler login"
  exit 1
fi
echo "Logged in."

# Resource ids are read from the LIST commands, never from `d1 info`:
# `d1 info <name>` resolves the name through wrangler.toml, which still
# holds a placeholder on a first run, so it fails with a 7404.
d1_id() {
  w d1 list --json 2>/dev/null | python3 -c '
import json,sys
try: rows=json.load(sys.stdin)
except Exception: rows=[]
print(next((r["uuid"] for r in rows if r.get("name")=="deep-groove"), ""))'
}
kv_id() {
  w kv namespace list 2>/dev/null | python3 -c '
import json,sys
try: rows=json.load(sys.stdin)
except Exception: rows=[]
print(next((r["id"] for r in rows if r.get("title","").endswith("CACHE")), ""))'
}

say "Creating D1 database (skipped if it exists)"
D1_ID="$(d1_id)"
if [ -n "$D1_ID" ]; then
  echo "deep-groove already exists"
else
  w d1 create deep-groove
  D1_ID="$(d1_id)"
fi
[ -n "$D1_ID" ] || { echo "Could not read the D1 id; check 'npx wrangler d1 list'"; exit 1; }
echo "D1 id: $D1_ID"

say "Creating R2 bucket (skipped if it exists)"
w r2 bucket create deep-groove-photos 2>&1 | tail -2 || echo "already exists"

say "Creating KV namespace (skipped if it exists)"
KV_ID="$(kv_id)"
if [ -z "$KV_ID" ]; then
  w kv namespace create CACHE >/dev/null 2>&1 || true
  KV_ID="$(kv_id)"
fi
[ -n "$KV_ID" ] || { echo "Could not create or find the CACHE namespace"; exit 1; }
echo "KV id: $KV_ID"

say "Writing the ids into wrangler.toml"
python3 - "$D1_ID" "$KV_ID" <<'PY'
import re, sys
d1, kv = sys.argv[1], sys.argv[2]
s = open('wrangler.toml', encoding='utf8').read()
s = re.sub(r'database_id = "[^"]*"', f'database_id = "{d1}"', s)
s = re.sub(r'(\[\[kv_namespaces\]\]\nbinding = "CACHE"\n)id = "[^"]*"', rf'\g<1>id = "{kv}"', s)
open('wrangler.toml', 'w', encoding='utf8').write(s)
print('wrangler.toml updated')
PY

# Read a single number back out of a remote query.
remote_num() {
  w d1 execute deep-groove --remote --yes --json --command "$1" 2>/dev/null | python3 -c '
import json,sys
raw=sys.stdin.read()
try:
  d=json.loads(raw[raw.index("["):])
  v=list(d[0]["results"][0].values())[0]
  print(0 if v is None else v)
except Exception:
  print(0)'
}

say "Applying the schema (only migrations not yet applied)"
APPLIED="$(remote_num 'SELECT MAX(version) FROM schema_migration;')"
echo "already applied: version $APPLIED"
for f in schema/*.sql; do
  # 001-init.sql -> 1. Re-running a CREATE TABLE is an error, not a
  # no-op, so idempotency has to come from the migration table.
  v=$(basename "$f" | sed -E 's/^0*([0-9]+).*/\1/')
  if [ "$v" -le "$APPLIED" ] 2>/dev/null; then
    echo "  skip $f (version $v)"
  else
    echo "  apply $f (version $v)"
    w d1 execute deep-groove --remote --file "$f" --yes >/dev/null
  fi
done

say "Loading the dataset"
[ -f data/seed.sql ] || node tools/load-dataset.mjs --sql
ROWS="$(remote_num 'SELECT COUNT(*) FROM item;')"
if [ "$ROWS" -gt 0 ] 2>/dev/null; then
  echo "$ROWS items already loaded; skipping (delete them first to reload)"
else
  w d1 execute deep-groove --remote --file data/seed.sql --yes >/dev/null
fi
w d1 execute deep-groove --remote --yes --command \
  "SELECT (SELECT COUNT(*) FROM item) items, (SELECT COUNT(*) FROM match_run) runs, (SELECT COUNT(*) FROM v_decision_eligible_item) eligible;"

say "Deploying the Worker"
w deploy

say "Building and deploying the client"
npm run build
w pages deploy dist --project-name deep-groove --commit-dirty=true

cat <<'DONE'

==> One step left, and it is yours: the Discogs token.

    npx wrangler secret put DISCOGS_TOKEN

    Paste the token when prompted. It is in
    "Pre August 2026/Windsurf Projects/discogs_personal_access_token".
    Until it is set, the cron matcher logs a warning and does nothing —
    everything else works.

DONE
