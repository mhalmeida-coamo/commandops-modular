# Escopo de Transição — Arquitetura Modular Completa

## Estado atual (CommandOps monolítico)

O CommandOps possui uma base parcialmente modular no backend: 11 microserviços Python independentes, cada um com Dockerfile próprio, porta dedicada e rota específica no nginx/gateway. A API central já possui `modules_registry`, `module_health` e o endpoint `/modules` que expõe status dinâmico.

**Problema no frontend:** `App.tsx` (~11.400 linhas) é um monólito que renderiza todos os módulos em JSX hardcoded. O `NAV` em `constants.ts` é estático. Para adicionar um novo módulo hoje, é necessário mexer em pelo menos 5 arquivos diferentes no `frontuser`.

## Estado alvo

```
┌─────────────────────────────────────────────────┐
│  shell (host)                                   │
│  - Login, sidebar, topbar, roteamento           │
│  - Não contém JSX de nenhum módulo              │
│  - Carrega módulos dinamicamente via MF         │
└────────────┬───────────────────────────────────┘
             │  /registry  (Module Registry API)
     ┌───────┴──────────────────────────┐
     │  Module Registry                 │
     │  id, name, version               │
     │  bundle_url, api_url             │
     │  nav_label, nav_order, icon      │
     │  required_roles, health          │
     └───────┬──────────────────────────┘
             │
  ┌──────────┼──────────┐
  ▼          ▼          ▼
┌─────┐  ┌─────┐  ┌──────────┐
│ vpn │  │ mdm │  │   ad     │  cada módulo:
│ fe  │  │ fe  │  │   fe     │  - frontend Vite remote
│ +   │  │ +   │  │   +      │  - backend FastAPI
│ be  │  │ be  │  │   be     │  - manifest.json
└─────┘  └─────┘  └──────────┘
```

## Estratégia escolhida: Module Federation (Opção A)

Cada módulo expõe um componente React via `remoteEntry.js` servido pelo próprio backend do módulo. O shell importa em runtime:

```typescript
const { VpnView } = await import("vpn/VpnView");
```

**Vantagens:**
- React e design system compartilhados (singleton)
- Hot module replacement funciona entre shell e módulos em dev
- CSS vars do design system herdadas automaticamente
- TypeScript end-to-end com tipos compartilhados

**Cuidados:**
- `react` e `react-dom` devem ser `shared: { singleton: true }` no Vite config
- Versão do React deve ser a mesma em todos os módulos
- `@commandops/ui` também deve ser singleton compartilhado

## O que NÃO muda nesta transição

- Autenticação central permanece no shell — módulos **nunca** gerenciam login
- Gateway nginx como único ponto de entrada — módulos não ficam expostos diretamente
- Banco de dados PostgreSQL compartilhado — módulos usam schemas separados, não bancos separados
- `frontadmin` permanece separado do shell — admin e operação não se misturam
