#!/usr/bin/env bash
set -euo pipefail

PY_BASE_URL="${PY_BASE_URL:-http://localhost:5101}"
GO_BASE_URL="${GO_BASE_URL:-http://localhost:5201}"
JWT_SECRET="${JWT_SECRET:-dev-secret-change-in-prod}"
VPN_USERNAME="${VPN_USERNAME:-mhalmeida}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "erro: comando '$1' não encontrado"; exit 1; }
}

require_cmd curl
require_cmd python

TOKEN="$(python - <<PY
from jose import jwt
print(jwt.encode({'sub':'contract-tester','role':'operador','is_platform_admin':False}, '${JWT_SECRET}', algorithm='HS256'))
PY
)"

request() {
  local method="$1"
  local url="$2"
  local auth="$3"
  local payload="${4:-}"

  local tmp
  tmp="$(mktemp)"

  if [[ -n "$payload" ]]; then
    if [[ "$auth" == "yes" ]]; then
      curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$payload"
    else
      curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url" \
        -H "Content-Type: application/json" \
        -d "$payload"
    fi
  else
    if [[ "$auth" == "yes" ]]; then
      curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url" \
        -H "Authorization: Bearer $TOKEN"
    else
      curl -sS -o "$tmp" -w "%{http_code}" -X "$method" "$url"
    fi
  fi

  echo "$tmp"
}

json_keys() {
  python - "$1" <<'PY'
import json,sys
path=sys.argv[1]
with open(path,'r',encoding='utf-8') as f:
    data=json.load(f)

def keys_of(obj):
    if isinstance(obj,dict):
        return sorted(obj.keys())
    return []

out={
  "root": keys_of(data),
  "result": keys_of(data.get("result",{})) if isinstance(data,dict) else [],
}
print(json.dumps(out, sort_keys=True))
PY
}

assert_eq() {
  local label="$1"
  local left="$2"
  local right="$3"
  if [[ "$left" != "$right" ]]; then
    echo "FALHA: $label"
    echo "  esperado: $left"
    echo "  obtido:   $right"
    exit 1
  fi
}

echo "[1/5] health"
py_code=$(request GET "$PY_BASE_URL/health" no)
py_body_file="$py_code"
py_status=$(tail -c 3 <<<"$(cat /dev/null)")
# status code is returned on stdout by request() substitution trick below

# Re-run to capture status and body separately (clearer flow)
py_body_file=$(mktemp); py_status=$(curl -sS -o "$py_body_file" -w "%{http_code}" "$PY_BASE_URL/health")
go_body_file=$(mktemp); go_status=$(curl -sS -o "$go_body_file" -w "%{http_code}" "$GO_BASE_URL/health")
assert_eq "health.status_code" "$py_status" "$go_status"
assert_eq "health.module" "$(python -c "import json;print(json.load(open('$py_body_file'))['module'])")" "$(python -c "import json;print(json.load(open('$go_body_file'))['module'])")"


echo "[2/5] status sem token"
py_body_file=$(mktemp); py_status=$(curl -sS -o "$py_body_file" -w "%{http_code}" "$PY_BASE_URL/api/vpn/status?username=$VPN_USERNAME")
go_body_file=$(mktemp); go_status=$(curl -sS -o "$go_body_file" -w "%{http_code}" "$GO_BASE_URL/api/vpn/status?username=$VPN_USERNAME")
assert_eq "status_no_token.status_code" "$py_status" "$go_status"


echo "[3/5] status com token"
py_body_file=$(mktemp); py_status=$(curl -sS -o "$py_body_file" -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$PY_BASE_URL/api/vpn/status?username=$VPN_USERNAME")
go_body_file=$(mktemp); go_status=$(curl -sS -o "$go_body_file" -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$GO_BASE_URL/api/vpn/status?username=$VPN_USERNAME")
assert_eq "status_auth.status_code" "$py_status" "$go_status"
assert_eq "status_auth.keys" "$(json_keys "$py_body_file")" "$(json_keys "$go_body_file")"


echo "[4/5] process com token"
payload=$(printf '{"username":"%s","enabled":true}' "$VPN_USERNAME")
py_body_file=$(mktemp); py_status=$(curl -sS -o "$py_body_file" -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$payload" "$PY_BASE_URL/api/vpn/process")
go_body_file=$(mktemp); go_status=$(curl -sS -o "$go_body_file" -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$payload" "$GO_BASE_URL/api/vpn/process")
assert_eq "process_auth.status_code" "$py_status" "$go_status"
assert_eq "process_auth.keys" "$(json_keys "$py_body_file")" "$(json_keys "$go_body_file")"


echo "[5/5] resumo"
echo "OK: paridade de contrato validada entre Python ($PY_BASE_URL) e Go ($GO_BASE_URL)."
