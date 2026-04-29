# Guia de Desenvolvimento

## Pré-requisitos

- Node.js >= 22
- Python >= 3.12
- Docker + Docker Compose
- npm >= 10

## Subir o ambiente local completo

```bash
make dev
```

Isso inicia todos os serviços via Docker Compose:

| Serviço | URL |
|---------|-----|
| Shell (host) | http://localhost:5000 |
| Module Registry | http://localhost:5010 |
| VPN módulo | http://localhost:5101 |
| Gateway nginx | http://localhost:8080 |
| PostgreSQL | localhost:5432 |

## Desenvolvimento com hot reload

Para desenvolver com HMR (sem rebuild Docker a cada mudança):

```bash
# Terminal 1 — Registry
make dev-registry

# Terminal 2 — Shell
make dev-shell

# Terminal 3 — Módulo que está desenvolvendo
make dev-module MODULE=vpn
```

## Criar um novo módulo

```bash
make new-module NAME=meu_modulo NAV_LABEL="Meu Módulo" NAV_ORDER=10
```

Isso cria a estrutura completa em `modules/meu_modulo/` com boilerplate pronto.

## Estrutura de portas

| Serviço | Porta |
|---------|-------|
| Shell | 5000 |
| Registry | 5010 |
| Gateway | 8080 |
| VPN | 5101 |
| MDM | 5102 |
| AD | 5103 |
| Cypress | 5104 |
| Azure | 5105 |
| Demitidos | 5106 |
| CADLOGIN | 5107 |
| Transferência | 5108 |
| PostgreSQL | 5432 |

## Fluxo de desenvolvimento de um módulo

1. Rodar `make dev-module MODULE=vpn` — servidor de dev do módulo na porta configurada
2. O shell em `localhost:5000` detecta automaticamente o módulo via Registry
3. Mudanças no módulo refletem com HMR sem recarregar o shell
4. Ao finalizar, buildar com `make build-module MODULE=vpn`
5. Rodar testes: `make test-module MODULE=vpn`
6. Abrir PR — CI valida build, lint e testes automaticamente

## Convenções de código

### TypeScript
- Nomes de arquivo: `PascalCase` para componentes, `camelCase` para utilitários
- Props sempre tipadas com `type`, não `interface` (consistência)
- Sem `any` — use `unknown` quando necessário e narrowing

### Python
- Formatação: `ruff format` (substituindo black)
- Lint: `ruff check`
- Tipagem: todas as funções públicas anotadas
- Testes: `pytest` com fixtures em `conftest.py`

### CSS
- CSS Modules obrigatório em módulos
- Nomes de classe: `camelCase` (ex: `.cardTitle`)
- Consumir sempre `var(--*)` do shell — nunca valores fixos de cor

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e ajuste:

```bash
cp .env.example .env.local
```

| Variável | Descrição |
|----------|-----------|
| `SHELL_PORT` | Porta do shell (padrão: 5000) |
| `REGISTRY_PORT` | Porta da registry API (padrão: 5010) |
| `POSTGRES_URL` | Connection string do PostgreSQL |
| `JWT_SECRET` | Chave para assinar tokens JWT |
| `OIDC_ENABLED` | Habilitar login via Keycloak |

## CI/CD (GitHub Actions)

Ao abrir um PR:
1. **lint** — ESLint + ruff em todos os módulos alterados
2. **typecheck** — `tsc --noEmit` no shell e módulos alterados
3. **test** — pytest com coverage nos backends alterados
4. **build** — build de produção do shell e módulos alterados

Merge na `main` dispara deploy automático no ambiente de desenvolvimento local (self-hosted runner).
