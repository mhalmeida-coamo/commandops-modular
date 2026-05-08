# CommandOps Modular

Projeto paralelo para migração progressiva do CommandOps para arquitetura modular.
**Não interfere no projeto original em `/opt/commandops/app`.**

## Estrutura

```
commandops-modular/
├── registry/          # Module Registry — descobre containers via Docker labels
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── shell/             # Shell App (Phase 2+) — host enxuto com iframe por módulo
├── docs/
│   └── MODULAR_CHANGELOG.md   # Registro de todas as decisões e mudanças
└── docker-compose.yml
```

## Como subir (Phase 1)

```bash
docker compose -f /opt/commandops-modular/docker-compose.yml up -d
```

## Verificar módulos descobertos

```bash
curl http://localhost:9000/modules | jq .
```

## Contrato de labels (cada container de módulo no projeto original)

```yaml
labels:
  commandops.module: "true"
  commandops.module.id: "userlock"
  commandops.module.name: "Bloqueio de Usuários"
  commandops.module.section: "identity"        # identity | network | devices
  commandops.module.permission: "userlock"
  commandops.module.version: "1.3.3"
  commandops.module.health_path: "/health"
```

## Fases

| Fase | O que entrega | Status |
|---|---|---|
| Phase 1 | Registry dinâmico via Docker labels + health em tempo real | ✅ Em andamento |
| Phase 2 | Shell App enxuto + protocolo iframe (token via postMessage) | 🔜 |
| Phase 3 | Módulo piloto com frontend próprio (UserLock) | 🔜 |
| Phase 4 | Migração progressiva dos demais módulos | 🔜 |
| Phase 5 | App.tsx residual zerado | 🔜 |
