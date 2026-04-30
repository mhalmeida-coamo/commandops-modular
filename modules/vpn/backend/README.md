# VPN Backend Go

Implementação inicial em Go para substituir o backend Python do módulo VPN.

## Endpoints
- `GET /health`
- `GET /api/vpn/status?username=<login>`
- `POST /api/vpn/process`

## Variáveis de ambiente
- `JWT_SECRET`
- `AD_WORKER_URL`
- `AD_WORKER_TOKEN`
- `SHELL_ORIGIN`
- `AD_WORKER_TIMEOUT_SECONDS` (default `30`)
- `SETTINGS_CACHE_TTL_SECONDS` (default `60`)

`REGISTRY_URL` e `SERVICE_SECRET` são opcionais e usados apenas como fallback legado.

## Build local (com Go instalado)
```bash
cd modules/vpn/backend
go mod tidy
go build ./...
```

## Build por Docker (sem Go local)
O Dockerfile do módulo foi preparado para compilar o binário Go e embutir o frontend estático.

## Subir em paralelo (canário local)
```bash
cd /opt/commandops-modular
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.go-migration.yml up -d vpn_go
```

Serviço exposto em `http://localhost:5201`.

## Validação rápida de API
```bash
# health
curl -s http://localhost:5201/health

# status sem token deve retornar 403
curl -i "http://localhost:5201/api/vpn/status?username=teste"
```

## Teste de contrato (Python vs Go)
```bash
cd /opt/commandops-modular
./scripts/contract-test-vpn.sh
```
