# CommandOps Modular

Arquitetura 100% modular do CommandOps, onde cada módulo opera de forma completamente independente com seu próprio backend (FastAPI) e frontend (Vite + React), conectados por um shell central via **Webpack Module Federation**.

## Visão geral

```
shell (host)
├── carrega módulos em runtime via Module Federation
├── gerencia autenticação JWT/OIDC centralmente
├── fornece design system compartilhado (@commandops/ui)
└── expõe Module Registry API

módulos (remotes)
├── vpn/        → frontend + backend próprio
├── mdm/        → frontend + backend próprio
├── ad/         → frontend + backend próprio
└── ...
```

## Tecnologias

| Camada | Tecnologia |
|--------|-----------|
| Shell frontend | React 18 + Vite + `@originjs/vite-plugin-federation` |
| Módulo frontend | React 18 + Vite (remote) |
| Backend módulos | Python 3.12 + FastAPI |
| Module Registry | Python 3.12 + FastAPI + PostgreSQL |
| Gateway | nginx |
| Orquestração | Docker Compose |
| Auth | JWT + OIDC (Keycloak) |

## Estrutura do repositório

```
commandops-modular/
├── shell/                  # Host — shell puro (auth, sidebar, roteamento)
├── modules/
│   └── vpn/                # Módulo piloto
│       ├── frontend/       # Vite remote
│       └── backend/        # FastAPI
├── registry/               # Module Registry API
├── shared/
│   └── ui/                 # Design system (@commandops/ui)
├── gateway/                # nginx
├── docs/                   # Documentação técnica
└── docker-compose.yml      # Ambiente local
```

## Início rápido

```bash
# Clonar e subir ambiente local completo
git clone https://github.com/mhalmeida-coamo/commandops-modular.git
cd commandops-modular
make dev
```

Acesse: http://localhost:5000

## Documentação

- [Escopo de transição](docs/scope.md)
- [Decisões arquiteturais](docs/architecture.md)
- [Fases do projeto](docs/phases.md)
- [Especificação de módulo](docs/module-spec.md)
- [Guia de desenvolvimento](docs/dev-guide.md)
