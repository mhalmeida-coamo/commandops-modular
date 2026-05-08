#!/bin/bash
REGISTRY_URL="${REGISTRY_URL:-http://localhost:9000}"
echo "=== CommandOps Module Registry — Validação ==="
echo "URL: $REGISTRY_URL"
echo ""
echo "[ Health ]"
curl -sf "$REGISTRY_URL/health" | python3 -m json.tool 2>/dev/null || { echo "FALHOU — registry não responde"; exit 1; }
echo ""
echo "[ Status por saúde ]"
curl -sf "$REGISTRY_URL/status" | python3 -m json.tool 2>/dev/null
echo ""
echo "[ Módulos descobertos ]"
curl -sf "$REGISTRY_URL/modules" | python3 -c "
import json, sys
mods = json.load(sys.stdin)
if not mods:
    print('Nenhum módulo descoberto. Verifique as labels nos containers.')
    sys.exit(1)
print(f'Total: {len(mods)}')
for m in mods:
    icon = {'healthy': 'OK', 'warning': 'WARN', 'danger': 'DOWN'}.get(m['health'], '?')
    print(f\"  [{icon:^4}] {m['id']:<22} {m['name']}\")
"
