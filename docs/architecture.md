# Decisões Arquiteturais (ADRs)

## ADR-001 — Module Federation como estratégia de micro-frontends

**Data:** 2026-04-29  
**Status:** Aceito

**Contexto:** Precisamos que cada módulo do CommandOps seja completamente independente (próprio frontend + backend), mas compartilhe React, design system e autenticação com o shell central.

**Decisão:** Usar `@originjs/vite-plugin-federation` (compatível com Webpack Module Federation spec). O shell é o **host**; cada módulo é um **remote**.

**Consequências:**
- `react`, `react-dom` e `@commandops/ui` declarados como `shared` com `singleton: true`
- Cada módulo expõe exatamente um componente raiz: `./ModuleView`
- O shell resolve o remote dynamicamente via URL do Module Registry

---

## ADR-002 — Module Registry como fonte de verdade

**Data:** 2026-04-29  
**Status:** Aceito

**Contexto:** O shell não pode ter conhecimento estático dos módulos — isso recria o problema do monólito.

**Decisão:** O Module Registry é uma API FastAPI separada com tabela PostgreSQL. O shell consome `/registry/modules` ao iniciar e constrói sidebar/roteamento dinamicamente. Nenhum módulo é conhecido em tempo de build pelo shell.

**Schema do módulo:**
```json
{
  "id": "vpn",
  "name": "VPN",
  "version": "1.2.0",
  "status": "enabled",
  "nav_label": "VPN",
  "nav_order": 6,
  "icon": "🔐",
  "remote_url": "http://localhost:5101/assets/remoteEntry.js",
  "api_url": "http://localhost:5101/api",
  "required_roles": ["admin", "operador"],
  "health": "healthy"
}
```

---

## ADR-003 — Propagação de autenticação via prop injection

**Data:** 2026-04-29  
**Status:** Aceito

**Contexto:** Módulos carregados via Module Federation rodam no mesmo contexto JavaScript do shell, mas não têm acesso ao estado interno do shell.

**Decisão:** O shell injeta o token JWT e o usuário como props ao renderizar o componente do módulo:

```tsx
<ModuleView token={jwt} user={currentUser} apiBase={module.api_url} />
```

Cada módulo recebe essas props e as usa para chamar seu próprio backend. O gateway nginx valida o JWT antes de rotear para qualquer microserviço.

**Alternativa rejeitada:** Context API global compartilhada — cria acoplamento implícito entre shell e módulos.

---

## ADR-004 — CSS isolation via CSS Modules + CSS vars herdadas

**Data:** 2026-04-29  
**Status:** Aceito

**Contexto:** Módulos carregados em runtime podem vazar estilos entre si e para o shell.

**Decisão:**
1. Todo CSS de módulo usa **CSS Modules** (Vite suporta nativamente — `.module.css`)
2. Classes são hasheadas em build — sem colisão de nomes
3. CSS custom properties do design system (`--panel`, `--text`, `--accent`, etc.) são definidas no shell em `:root` e herdadas por todos os módulos automaticamente
4. Módulos **não definem** valores de tema — apenas consomem as vars do shell

---

## ADR-005 — Versionamento independente por módulo

**Data:** 2026-04-29  
**Status:** Aceito

**Contexto:** Módulos devem poder ser deployados independentemente sem coordenação com o shell.

**Decisão:** Cada módulo tem `package.json` com `version` própria. O Module Registry armazena a versão deployada. O shell declara `min_shell_version` que o módulo requer — incompatibilidade bloqueia carregamento com erro claro no UI.

**Formato:** `MAJOR.MINOR.PATCH`
- MAJOR: mudança incompatível na interface de props
- MINOR: nova funcionalidade retrocompatível
- PATCH: bug fix

---

## ADR-006 — ErrorBoundary obrigatório por módulo carregado

**Data:** 2026-04-29  
**Status:** Aceito

**Contexto:** Um módulo com bug em runtime não pode derrubar o shell inteiro.

**Decisão:** O shell sempre envolve o componente do módulo em um `<ModuleErrorBoundary>`. Se o módulo lançar erro, o shell exibe um painel de erro isolado e registra no sistema de observabilidade. Os demais módulos continuam funcionando.

---

## Diagrama de comunicação

```
Browser
  │
  └─ GET /  →  shell (port 5000)
       │
       ├─ GET /registry/modules  →  registry API (port 5010)
       │       └─ retorna lista de módulos com remote_url
       │
       ├─ import(module.remote_url)  →  módulo frontend (port 510x)
       │       └─ retorna remoteEntry.js → componente React
       │
       └─ fetch(module.api_url/*)  →  nginx gateway (port 80)
               └─ valida JWT → roteia para backend do módulo
```
