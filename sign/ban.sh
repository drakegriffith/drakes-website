#!/usr/bin/env bash
# ban.sh - ban or unban one email on the pledge registry, from the terminal.
#
#   ./sign/ban.sh them@example.com "Every paragraph the same length."
#   ./sign/ban.sh --unban them@example.com
#   ./sign/ban.sh --local them@example.com "reason"   # node sign/server.js
#
# A ban is public and permanent by default: the row stays on the signatory
# list with the reason and date showing. This is not deletion. Unban puts the
# row back to plain "signed" and drops the reason.
#
# The admin token is never an argument - arguments land in shell history and
# in `ps`. It is read from a scoped secrets file (600), and handed to curl
# through a config on stdin so it never appears in the process list either.
#
# No dependencies beyond bash, curl and python3 (python3 does the JSON, so a
# reason containing quotes or a newline cannot break the request).

set -euo pipefail

LIVE="https://pledge-registry.actualintelligence.workers.dev"
LOCAL="http://localhost:8787"
TOKEN_FILE="${TOKEN_FILE:-$HOME/brain-actual-intelligence/.secrets/pledge-registry.env}"
BASE="${REGISTRY:-$LIVE}"

usage() {
  cat >&2 <<'USAGE'
usage:
  ./sign/ban.sh <email> "<reason>"     ban, with the reason that goes public
  ./sign/ban.sh --unban <email>        lift a ban
options:
  --local        talk to http://localhost:8787 (node sign/server.js)
  --at <url>     talk to some other base URL
the token comes from ~/brain-actual-intelligence/.secrets/pledge-registry.env
and is never passed as an argument.
USAGE
  exit 2
}

ACTION="ban"
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --unban)  ACTION="unban"; shift ;;
    --local)  BASE="$LOCAL"; shift ;;
    --at)     BASE="${2:-}"; [ -n "$BASE" ] || usage; shift 2 ;;
    -h|--help) usage ;;
    -*)       echo "ban.sh: unknown option: $1" >&2; usage ;;
    *)        ARGS+=("$1"); shift ;;
  esac
done

EMAIL="${ARGS[0]:-}"
REASON="${ARGS[1]:-}"
[ -n "$EMAIL" ] || usage
if [ "$ACTION" = "ban" ] && [ -z "$REASON" ]; then
  echo "ban.sh: a ban needs a reason - it is published next to the name." >&2
  usage
fi
if [ "$ACTION" = "unban" ] && [ -n "$REASON" ]; then
  echo "ban.sh: unban takes an email and nothing else." >&2
  usage
fi

# ---- the token ------------------------------------------------------------
# Sourced, never printed. If this file is missing there is no point going on:
# every admin call would come back 401.
if [ ! -f "$TOKEN_FILE" ]; then
  cat >&2 <<EOF
ban.sh: no token file at
  $TOKEN_FILE
That file holds ADMIN_TOKEN, the same value as the Worker secret. It is not in
the repo and never will be. Restore it (see issue #6) with:
  mkdir -p "$(dirname "$TOKEN_FILE")" && chmod 700 "$(dirname "$TOKEN_FILE")"
  open -e "$TOKEN_FILE"        # add one line: ADMIN_TOKEN=<the token>
  chmod 600 "$TOKEN_FILE"
Or point somewhere else for one run: TOKEN_FILE=/path/to.env ./sign/ban.sh ...
EOF
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$TOKEN_FILE"
set +a
if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "ban.sh: $TOKEN_FILE exists but sets no ADMIN_TOKEN. It needs a line reading ADMIN_TOKEN=<the token>." >&2
  exit 1
fi

# ---- the call -------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

EMAIL="$EMAIL" REASON="$REASON" python3 - "$TMP/req.json" <<'PY'
import json, os, sys
body = {"email": os.environ["EMAIL"]}
if os.environ.get("REASON"):
    body["reason"] = os.environ["REASON"]
open(sys.argv[1], "w").write(json.dumps(body))
PY

echo "registry: $BASE"
echo "${ACTION}ning ${EMAIL} ..."

# curl reads the auth header from a config on stdin, so the token stays out of
# the process list. The URL and the body file are not secret and stay in argv.
code="$(printf 'header = "x-admin-token: %s"\n' "$ADMIN_TOKEN" | curl -sS -K - \
  -X POST "$BASE/api/$ACTION" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP/req.json" \
  -o "$TMP/resp.json" -w '%{http_code}')" || {
  echo "ban.sh: could not reach $BASE - nothing was changed." >&2
  exit 1
}

# ---- what happened --------------------------------------------------------
case "$code" in
  200) : ;;
  401)
    cat >&2 <<EOF
ban.sh: 401 - the registry rejected the token.
Nothing was changed. The ADMIN_TOKEN in
  $TOKEN_FILE
is not the one held by
  $BASE
The two are set separately; if one was rotated, the other has to be too:
  wrangler secret put ADMIN_TOKEN --config sign/wrangler.toml
EOF
    exit 1 ;;
  404)
    cat >&2 <<EOF
ban.sh: 404 - nobody by that email has signed. Nothing was changed.
  $EMAIL
Bans only apply to rows that exist; there is no ban list for strangers. Check
the spelling, and check what the registry thinks:
  curl -s "$BASE/api/status?email=$EMAIL"
EOF
    exit 1 ;;
  *)
    echo "ban.sh: unexpected HTTP $code from $BASE/api/$ACTION - nothing is guaranteed to have changed." >&2
    cat "$TMP/resp.json" >&2 || true
    echo >&2
    exit 1 ;;
esac

# The admin reply carries the updated row, but the point of a ban is that it is
# public - so read it back from the public endpoint the site itself calls.
curl -sS "$BASE/api/signatures" -o "$TMP/list.json" || true

ACTION="$ACTION" python3 - "$TMP/resp.json" "$TMP/list.json" <<'PY'
import json, os, sys

action = os.environ["ACTION"]
row = json.load(open(sys.argv[1]))["signature"]

print()
print(f"{action}ned. #{row['number']}  {row['name']}")
print(f"  status:    {row['status']}")
if row.get("ban_reason"):
    print(f"  reason:    {row['ban_reason']}")
    print(f"  banned at: {row['banned_at']}")

try:
    listing = json.load(open(sys.argv[2]))
except Exception:
    print("\n(could not read back the public list)")
    raise SystemExit(0)

print("\npublic list, GET /api/signatures:")
for r in listing["signatures"]:
    mark = "BANNED" if r["status"] == "banned" else "signed"
    line = f"  #{r['number']:<4} {r['name']:<22} {mark}"
    if r["status"] == "banned":
        line += f"  {r['ban_reason']}"
    print(line)
print(f"  -- {listing['count']} signed, {listing['banned']} banned")

if action == "ban":
    print("\nThe row stays on the list with the reason showing. A ban is public")
    print("and permanent by default; it is not deletion.")
PY
