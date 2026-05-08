# CommandOps — Changelog de Modularização

> Registro contínuo de todas as decisões, mudanças e artefatos criados durante a migração para arquitetura modular.
> Será consolidado na documentação final da plataforma.

---

## Phase 1 — Registry dinâmico + Sidebar health-aware

**Objetivo:** Containers com `commandops.module=true` são auto-descobertos. Sidebar oculta módulos cujo container está offline e os exibe quando voltam.

**Data de início:** 2026-05-08

---

### 1.1 Diagnóstico do estado anterior

| Componente | Estado antes da Phase 1 |
|---|---|
| `modules_registry.py` | Dict estático hardcoded com 14 módulos |
| `module_health.py` | Já fazia probe HTTP nos `/health` dos MSes |
| Frontend `/modules` poll | Apenas 1x no login e ao visitar "home" |
| Sidebar visibilidade | Baseada em `module.status === "enabled"` — ignorava `health` |
| Docker labels | Nenhuma label `commandops.*` nos containers |
| Docker socket | Não montado na API |

---

### 1.2 Decisões de arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Descoberta de containers | Docker SDK via socket montado | Fonte de verdade real sem depender de MS estar respondendo |
| Fallback quando sem socket | Mantém dict estático | Não quebra ambientes sem Docker |
| Protocolo de registro | Labels Docker `commandops.module.*` | Agnóstico de linguagem, sem código extra no container |
| Frontend poll interval | 30 segundos | Equilibra reatividade e overhead |
| Critério de ocultação | `health === "danger"` | Distingue "desabilitado pelo admin" de "container caiu" |
| Indicador visual | Dot colorido na sidebar | Não invasivo, info rápida |

---

### 1.3 Contrato de labels Docker (padrão definido)

```yaml
labels:
  commandops.module: "true"
  commandops.module.id: "<id>"               # ex: userlock
  commandops.module.name: "<Nome Legível>"   # ex: Bloqueio de Usuários
  commandops.module.section: "<seção>"       # identity | network | devices
  commandops.module.permission: "<perm>"     # permissão necessária
  commandops.module.version: "<semver>"      # ex: 1.3.3
  commandops.module.health_path: "/health"   # path do healthcheck HTTP
```

---

### 1.4 Arquivos criados/modificados

| Arquivo | Tipo | Descrição |
|---|---|---|
| `api/requirements.txt` | modificado | + `docker==7.1.0` |
| `api/app/services/docker_discovery.py` | criado | Lê socket Docker, retorna módulos via labels |
| `api/app/services/modules_registry.py` | modificado | Merge estático + descoberta dinâmica |
| `api/app/services/module_health.py` | modificado | Usa estado Docker como fonte primária de health |
| `docker-compose.yml` | modificado | Socket montado na API + labels em todos os MSes |
| `frontuser/src/App.tsx` | modificado | Poll 30s + `resolveModuleStatus` checa health |
| `frontuser/src/components/Sidebar.tsx` | modificado | Dot de saúde por módulo |

---

### 1.5 Mapeamento de módulos → labels aplicadas

| container_name | module.id | module.section | module.name |
|---|---|---|---|
| commandops-userlock-ms | userlock | identity | Bloqueio de Usuários |
| commandops-vpn-ms | vpn | network | VPN |
| commandops-cadlogin-ms | cadlogin | identity | CADLOGIN |
| commandops-demitidos-ms | demitidos | identity | Demitidos |
| commandops-mdm-ms | mdm | devices | MDM (MobiControl) |
| commandops-transfer-ms | ad_transfer | identity | Transferência de Funcionário |
| commandops-cypress-ms | smb_cypress | identity | Cypress |
| commandops-azure-squid-ms | azure_squid | network | Azure/Postfix |
| commandops-ad-ms | ad_ldap | identity | AD / Usuários |
| commandops-ad-create-ms | ad_create | identity | Criar Estagiário/Terceiro |
| commandops-ssh-ms | ssh | network | Internet (SSH) |
| commandops-observability-ms | observability_ms | — | Observability Core |

---

### 1.6 Fluxo de descoberta (runtime)

```
API container inicia
      │
      ▼
docker_discovery.py conecta ao /var/run/docker.sock
      │
      ▼
Lista todos containers com label commandops.module=true
      │
      ▼
Para cada container extrai labels → constrói ModuleInfo
      │
      ├── container.status == "running" + health == "healthy" → health: "healthy"
      ├── container.status == "running" + sem healthcheck     → proba HTTP /health
      └── container.status != "running"                       → health: "danger"
      │
      ▼
modules_registry.merge(static_modules, discovered_modules)
      │   descoberto tem prioridade sobre estático para campos dinâmicos
      ▼
GET /modules retorna lista mesclada com health em tempo real
```

---

### 1.7 Fluxo frontend (sidebar dinâmica)

```
Login → fetch /modules (1x)
      │
      ▼
setInterval 30s → fetch /modules
      │
      ▼
modules[] atualizado → moduleMap atualizado
      │
      ▼
resolveModuleStatus(id):
  if module.health === "danger"  → {enabled: false, reason: "Container offline"}
  if module.status !== "enabled" → {enabled: false, reason: "Módulo desabilitado"}
  else                           → {enabled: true}
      │
      ▼
isNavVisible(id) → false se not enabled
      │
      ▼
Sidebar oculta o item automaticamente
(sem reload, sem intervenção manual)
```

---

*Próximas entradas serão adicionadas conforme a implementação avança.*
