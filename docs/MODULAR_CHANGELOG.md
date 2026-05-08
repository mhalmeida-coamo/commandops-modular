# CommandOps — Changelog de Modularização

> Registro contínuo de todas as decisões, mudanças e artefatos criados durante a migração para arquitetura modular.
> Será consolidado na documentação final da plataforma.

---

## Phase 1 — Module Registry (projeto paralelo)

**Objetivo:** Criar um serviço de descoberta de módulos completamente separado do projeto original, que detecta containers via Docker labels e expõe uma API REST com health em tempo real.

**Princípio fundamental:** o projeto original em `/opt/commandops/app` não deve ser alterado em nenhum momento nesta fase.

**Data de início:** 2026-05-08
**Status:** CONCLUÍDA ✓

---

### 1.1 Decisão: projeto paralelo, não modificação do existente

A primeira abordagem considerada era modificar o projeto original (`modules_registry.py`, `docker-compose.yml`, `App.tsx`). Essa abordagem foi descartada porque:

- Misturaria o código de migração com o código de produção estável
- Qualquer erro derrubaria o sistema existente
- Não testaria o conceito antes de comprometer o projeto

**Decisão final:** criar `/opt/commandops-modular/` como repositório Git independente. O projeto original continua intocado.

---

### 1.2 Protocolo de registro via Docker labels

Módulos se registram adicionando labels ao seu container — sem código extra, sem dependência de linguagem:

```yaml
labels:
  commandops.module: "true"
  commandops.module.id: "<id>"               # ex: userlock
  commandops.module.name: "<Nome Legível>"   # ex: Bloqueio de Usuários
  commandops.module.section: "<seção>"       # identity | network | devices
  commandops.module.permission: "<perm>"     # permissão requerida para exibir
  commandops.module.version: "<semver>"      # ex: 1.3.3
  commandops.module.health_path: "/health"   # path do healthcheck HTTP
```

Qualquer container com `commandops.module=true` é automaticamente descoberto.

---

### 1.3 Decisões de arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Isolamento do projeto original | Projeto paralelo em repositório separado | Zero risco para produção durante desenvolvimento |
| Aplicação de labels nos containers existentes | Docker Compose override file | Original `docker-compose.yml` nunca é modificado |
| Descoberta de containers | Docker SDK via socket montado (`/var/run/docker.sock`) | Fonte de verdade real, agnóstico de linguagem |
| Cache em caso de falha no socket | Retorna cache anterior | Evita flicker de "módulo offline" em erros temporários |
| Containers parados | `all=True` no `containers.list()` | Detecta containers stopped → health `danger` |
| Mapeamento de health | Docker state → `healthy/warning/danger` | 3 estados suficientes para UI |
| Poll de atualização | 30s background loop via `asyncio` | Equilibra reatividade e overhead |
| Porta do registry | 9000 | Livre no host, não conflita com Portainer |

---

### 1.4 Estrutura do projeto

```
/opt/commandops-modular/
├── docker-compose.yml          # sobe apenas o registry
├── labels-override.yml         # aplica labels nos containers do projeto original
├── registry/
│   ├── Dockerfile
│   ├── main.py                 # FastAPI — descoberta + endpoints
│   └── requirements.txt
├── scripts/
│   └── validate.sh             # bate nos 3 endpoints e imprime resultado
├── gateway/
│   └── nginx.conf              # preparado para Phase 2 (shell + roteamento)
└── docs/
    ├── MODULAR_CHANGELOG.md    # este arquivo
    ├── architecture.md
    ├── phases.md
    └── module-spec.md
```

---

### 1.5 Aplicação das labels nos containers existentes

As labels são aplicadas sem modificar o `docker-compose.yml` original usando um override file:

```bash
docker compose \
  -f /opt/commandops/app/docker-compose.yml \
  -f /opt/commandops-modular/labels-override.yml \
  up -d
```

| container | module.id | module.section | module.name |
|---|---|---|---|
| commandops-mdm-ms | mdm | devices | MDM (MobiControl) |
| commandops-cadlogin-ms | cadlogin | identity | CADLOGIN |
| commandops-azure-squid-ms | azure_squid | network | Azure/Postfix |
| commandops-demitidos-ms | demitidos | identity | Demitidos |
| commandops-ssh-ms | ssh | network | Internet (SSH) |
| commandops-ad-ms | ad_ldap | identity | AD / Usuários |
| commandops-vpn-ms | vpn | network | VPN |
| commandops-ad-create-ms | ad_create | identity | Criar Estagiário/Terceiro |
| commandops-transfer-ms | ad_transfer | identity | Transferência de Funcionário |
| commandops-cypress-ms | smb_cypress | identity | Cypress |
| commandops-userlock-ms | userlock | identity | Bloqueio de Usuários |

---

### 1.6 Endpoints do registry

| Endpoint | Descrição |
|---|---|
| `GET /modules` | Lista todos os módulos descobertos (cache 30s) |
| `GET /modules/{id}` | Detalhe de um módulo específico |
| `GET /health` | Health do registry + stats (erros, último poll) |
| `GET /status` | Totais agrupados por estado de health |

---

### 1.7 Fluxo de descoberta (runtime)

```
Registry inicia
      │
      ▼
Startup: _discover() roda imediatamente
      │
      ▼
Docker socket → containers.list(all=True, filters={"label": "commandops.module=true"})
      │
      ▼
Para cada container com label commandops.module.id:
  ├── container.status != "running"              → health: "danger"
  ├── container.status == "running" + healthcheck → mapeia Docker health state
  └── container.status == "running" + sem healthcheck → health: "healthy"
      │
      ▼
Ordena por (section, name) → _modules_cache atualizado
      │
      ▼
Background loop: repete a cada 30s
      │
      ▼
Em caso de erro no socket → mantém cache anterior, incrementa _poll_errors
```

---

### 1.8 Resultado do teste de validação (2026-05-08)

```
=== CommandOps Module Registry — Validação ===
URL: http://localhost:9000

[ Health ]
{
    "status": "ok",
    "modules_discovered": 11,
    "poll_errors": 0,
    "poll_interval_seconds": 30
}

[ Status por saúde ]
total: 11
healthy: mdm, ad_ldap, userlock, cadlogin, ad_create,
         smb_cypress, demitidos, ad_transfer, azure_squid, ssh, vpn
warning: []
danger:  []

[ Módulos descobertos ]
  [ OK ] mdm                    MDM (MobiControl)
  [ OK ] ad_ldap                AD / Usuários
  [ OK ] userlock               Bloqueio de Usuários
  [ OK ] cadlogin               CADLOGIN
  [ OK ] ad_create              Criar Estagiário/Terceiro
  [ OK ] smb_cypress            Cypress
  [ OK ] demitidos              Demitidos
  [ OK ] ad_transfer            Transferência de Funcionário
  [ OK ] azure_squid            Azure/Postfix
  [ OK ] ssh                    Internet (SSH)
  [ OK ] vpn                    VPN
```

11/11 módulos descobertos, 0 erros, todos healthy.

---

### 1.9 Commits da Phase 1

| Hash | Mensagem |
|---|---|
| `ef4665a` | chore: init commandops-modular |
| `f14380f` | feat(phase1): module registry com descoberta Docker + docs |
| `6e09328` | feat(phase1): labels override + melhorias no registry + script de validação |

---

## Phase 2 — Shell App + micro-frontend via iframe (planejado)

**Objetivo:** Criar uma shell app React que substitui o `App.tsx` monolítico. Cada módulo é carregado como `<iframe>` apontando para o container do próprio módulo. Comunicação via `postMessage` (token, tema, idioma).

**Princípio:** a shell consulta o registry para saber quais iframes carregar. Módulos offline simplesmente não aparecem.

**Status:** PENDENTE

### Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Comunicação shell → módulo | `postMessage` com protocolo padronizado |
| Autenticação | Shell injeta JWT via `postMessage` após login |
| Roteamento | Shell controla URL, iframe renderiza rota interna |
| Sidebar dinâmica | Baseada em `GET /modules` do registry |

---

## Phase 3 — Módulo piloto migrado (planejado)

**Objetivo:** Migrar um módulo real (candidato: `userlock`) para ter seu próprio repositório com backend + frontend independentes.

**Status:** PENDENTE

---

## Phase 4 — Migração progressiva (planejado)

**Objetivo:** Migrar módulos restantes um a um.

**Status:** PENDENTE

---

## Phase 5 — Zero monolito (planejado)

**Objetivo:** O projeto original `/opt/commandops/app` é aposentado. Toda a lógica vive nos containers de módulo.

**Status:** PENDENTE

---

*Atualizado em: 2026-05-08*
