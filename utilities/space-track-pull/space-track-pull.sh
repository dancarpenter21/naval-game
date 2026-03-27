#!/usr/bin/env bash
# Fetch Space-Track SATCAT metadata + GP ephemerides (3LE or JSON) and optionally merge.
#
# Prerequisites: bash, curl, python3 (JSON + URL encoding). Optional: run via Docker (see docker-run.sh).
#
# Credentials (do not commit):
#   export SPACE_TRACK_IDENTITY='your@email'
#   export SPACE_TRACK_PASSWORD='your_password'
# Optional: SPACE_TRACK_COOKIE_JAR (default: ./.space-track-cookies.txt)
# Optional: SPACE_TRACK_ENV_FILE — source this file before reading env (default: ./.env if present)
#
# API guidelines: https://www.space-track.org/documentation#api-useGuidelines
#   — GP (TLE/3LE): at most about once per hour for bulk/current elsets.
#   — SATCAT: at most about once per day for large pulls; prefer narrow predicates.
#   — Batch NORAD_CAT_ID with commas; avoid one HTTP request per satellite.
#
set -euo pipefail

BASE="${SPACE_TRACK_BASE:-https://www.space-track.org}"
COOKIE_JAR="${SPACE_TRACK_COOKIE_JAR:-$(pwd)/.space-track-cookies.txt}"

load_env_file() {
  local f="${SPACE_TRACK_ENV_FILE:-}"
  if [[ -z "$f" && -f "$(pwd)/.env" ]]; then
    f="$(pwd)/.env"
  fi
  if [[ -n "$f" && -f "$f" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$f"
    set +a
  fi
}

require_creds() {
  if [[ -z "${SPACE_TRACK_IDENTITY:-}" || -z "${SPACE_TRACK_PASSWORD:-}" ]]; then
    echo "Set SPACE_TRACK_IDENTITY and SPACE_TRACK_PASSWORD (or add them to .env)." >&2
    exit 1
  fi
}

require_python3() {
  command -v python3 >/dev/null 2>&1 || {
    echo "This command needs python3 (use Docker: utilities/space-track-pull/docker-run.sh …)." >&2
    exit 1
  }
}

# Encode a single path segment. Space-Track rejects raw ^ and ~ in URLs.
uri_segment_encode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

st_login() {
  require_creds
  curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    "$BASE/ajaxauth/login" \
    -d "identity=${SPACE_TRACK_IDENTITY}&password=${SPACE_TRACK_PASSWORD}"
  echo "" >&2
  echo "Login POST complete. Cookie jar: $COOKIE_JAR" >&2
}

st_logout() {
  curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE/ajaxauth/logout" >/dev/null || true
  echo "Logout sent." >&2
}

# GET with session cookie (path begins with /basicspacedata/...).
st_get() {
  local path="$1"
  curl -sS -g -b "$COOKIE_JAR" "${BASE}${path}"
}

# Login once before any data request (session cookie).
api_prep() {
  load_env_file
  require_creds
  st_login >/dev/null
}

# --- SATCAT ---
satcat_active_prefix() {
  require_python3
  local prefix="$1"
  local enc
  enc="$(uri_segment_encode "^${prefix}")"
  st_get "/basicspacedata/query/class/satcat/CURRENT/Y/DECAY/null-val/OBJECT_NAME/${enc}/format/json"
}

satcat_active_like() {
  require_python3
  local like_pattern="$1"
  local enc
  enc="$(uri_segment_encode "~~${like_pattern}")"
  st_get "/basicspacedata/query/class/satcat/CURRENT/Y/DECAY/null-val/OBJECT_NAME/${enc}/format/json"
}

satcat_raw() {
  local tail="${1#/}"
  st_get "/basicspacedata/query/class/satcat/${tail}"
}

satcat_gps_bundle() {
  require_python3
  local t1 t2
  t1="$(mktemp "${TMPDIR:-/tmp}/st-satcat1.XXXXXX")"
  t2="$(mktemp "${TMPDIR:-/tmp}/st-satcat2.XXXXXX")"
  satcat_active_prefix NAVSTAR >"$t1"
  satcat_active_prefix GPS >"$t2"
  python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    a = json.load(f)
with open(sys.argv[2]) as f:
    b = json.load(f)
seen = set()
out = []
for row in a + b:
    k = row.get("NORAD_CAT_ID")
    if k in seen:
        continue
    seen.add(k)
    out.append(row)
print(json.dumps(out))
' "$t1" "$t2"
  rm -f "$t1" "$t2"
}

gp_json_ids() {
  local ids="$1"
  st_get "/basicspacedata/query/class/gp/norad_cat_id/${ids}/format/json"
}

gp_3le_ids() {
  local ids="$1"
  st_get "/basicspacedata/query/class/gp/norad_cat_id/${ids}/format/3le"
}

gp_json_ids_chunked() {
  local ids_csv="$1"
  local chunk="${SPACE_TRACK_GP_CHUNK:-40}"
  require_python3
  local tmpd c joined
  tmpd="$(mktemp -d "${TMPDIR:-/tmp}/stgp.XXXXXX")"
  c=0
  IFS=',' read -r -a arr <<<"${ids_csv// /}"
  local batch=() n=0
  for id in "${arr[@]}"; do
    [[ -z "$id" ]] && continue
    batch+=("$id")
    ((n++))
    if (( n >= chunk )); then
      joined=$(IFS=','; echo "${batch[*]}")
      gp_json_ids "$joined" >"$tmpd/p${c}.json"
      ((c++))
      batch=()
      n=0
    fi
  done
  if ((${#batch[@]} > 0)); then
    joined=$(IFS=','; echo "${batch[*]}")
    gp_json_ids "$joined" >"$tmpd/p${c}.json"
    ((c++))
  fi
  if [[ "$c" -eq 0 ]]; then
    echo '[]'
    rm -rf "$tmpd"
    return
  fi
  python3 -c '
import glob, json, sys
acc = []
for path in sorted(glob.glob(sys.argv[1] + "/p*.json")):
    with open(path) as f:
        acc.extend(json.load(f))
print(json.dumps(acc))
' "$tmpd"
  rm -rf "$tmpd"
}

merge_satcat_gp() {
  require_python3
  local satcat_json="$1"
  local gp_json="$2"
  python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    satcat = json.load(f)
with open(sys.argv[2]) as f:
    gp = json.load(f)
gp_by_id = {}
for row in gp:
    k = row.get("NORAD_CAT_ID")
    if k is None:
        continue
    gp_by_id[str(k)] = row
out = []
for row in satcat:
    nid = row.get("NORAD_CAT_ID")
    copy = dict(row)
    copy["gp"] = gp_by_id.get(str(nid)) if nid is not None else None
    out.append(copy)
print(json.dumps(out))
' "$satcat_json" "$gp_json"
}

usage() {
  cat >&2 <<'EOF'
Usage:
  space-track-pull.sh login
  space-track-pull.sh logout
  space-track-pull.sh satcat-gps
  space-track-pull.sh satcat-comm
  space-track-pull.sh satcat-like PATTERN
  space-track-pull.sh satcat-raw PATH_TAIL
  space-track-pull.sh gp-json NORAD1,NORAD2,...
  space-track-pull.sh gp-3le NORAD1,NORAD2,...
  space-track-pull.sh merge SATCAT.json GP.json
  space-track-pull.sh pipeline-gps [out.json]

Docker (no local python): utilities/space-track-pull/docker-run.sh build && utilities/space-track-pull/docker-run.sh satcat-gps
EOF
}

cmd="${1:-}"
case "$cmd" in
  login)
    load_env_file
    st_login
    ;;
  logout)
    st_logout
    ;;
  satcat-gps)
    api_prep
    satcat_gps_bundle
    ;;
  satcat-comm)
    api_prep
    pref="${SPACE_TRACK_COMM_PREFIX:-STARLINK}"
    satcat_active_prefix "$pref"
    ;;
  satcat-like)
    api_prep
    [[ -n "${2:-}" ]] || {
      usage
      exit 1
    }
    satcat_active_like "$2"
    ;;
  satcat-raw)
    api_prep
    [[ -n "${2:-}" ]] || {
      usage
      exit 1
    }
    satcat_raw "$2"
    ;;
  gp-json)
    api_prep
    [[ -n "${2:-}" ]] || {
      usage
      exit 1
    }
    gp_json_ids "$2"
    ;;
  gp-3le)
    api_prep
    [[ -n "${2:-}" ]] || {
      usage
      exit 1
    }
    gp_3le_ids "$2"
    ;;
  merge)
    [[ -n "${2:-}" && -n "${3:-}" ]] || {
      usage
      exit 1
    }
    merge_satcat_gp "$2" "$3"
    ;;
  pipeline-gps)
    api_prep
    require_python3
    outfile="${2:-}"
    tmpd="$(mktemp -d "${TMPDIR:-/tmp}/stgp.XXXXXX")"
    trap 'rm -rf "$tmpd"' EXIT
    echo "Fetching SATCAT (GPS)…" >&2
    satcat_gps_bundle >"$tmpd/satcat.json"
    ids="$(python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(",".join(str(x["NORAD_CAT_ID"]) for x in d))
' "$tmpd/satcat.json")"
    if [[ -z "$ids" || "$ids" == "null" ]]; then
      echo "No NORAD IDs from satcat-gps." >&2
      exit 1
    fi
    echo "Fetching GP JSON (chunked)…" >&2
    gp_json_ids_chunked "$ids" >"$tmpd/gp.json"
    merge_satcat_gp "$tmpd/satcat.json" "$tmpd/gp.json" >"$tmpd/out.json"
    if [[ -n "$outfile" ]]; then
      cp "$tmpd/out.json" "$outfile"
      echo "Wrote $outfile" >&2
    else
      cat "$tmpd/out.json"
    fi
    ;;
  "" | -h | --help | help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
