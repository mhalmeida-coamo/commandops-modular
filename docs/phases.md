# Fases do Projeto

## Fase 0 — Fundação ✅ Em andamento

**Objetivo:** Infraestrutura base. Nenhum módulo de negócio ainda, mas o shell funciona end-to-end com Module Federation configurado.

**Entregas:**
- [x] Repositório GitHub criado (`commandops-modular`)
- [x] Documentação técnica (scope, architecture, phases, module-spec)
- [ ] Shell (host) funcional: login simulado, sidebar dinâmica, topbar
- [ ] Module Registry API: CRUD de módulos, health check
- [ ] Módulo VPN piloto: `remoteEntry.js` servido, componente carregado pelo shell
- [ ] Design system base (`@commandops/ui`): CSS vars, componentes Button/Input/Badge
- [ ] Docker Compose local: shell + registry + vpn + gateway + postgres
- [ ] CI/CD: GitHub Actions — build e lint em cada PR

**Critério de conclusão:** Shell carrega o módulo VPN dinamicamente, token JWT é injetado, chamada ao backend VPN é autenticada pelo gateway.

---

## Fase 1 — Módulos simples (baixa complexidade)

**Objetivo:** Extrair 3 módulos de baixa complexidade do CommandOps monolítico para o novo padrão.

**Módulos:**
| Módulo | Complexidade | Estimativa |
|--------|-------------|------------|
| VPN | Baixa | 1 semana |
| Cypress | Baixa | 1 semana |
| Azure/Postfix | Baixa | 1 semana |

**Entregas por módulo:**
- Backend FastAPI com endpoints migrados do microserviço atual
- Frontend Vite remote com UI completa migrada do App.tsx monolítico
- Testes de integração (pytest) para o backend
- Registro no Module Registry
- Deploy no docker-compose local

**Critério de conclusão:** Os 3 módulos funcionam identicamente ao monolítico, com coverage de testes > 80% nos backends.

---

## Fase 2 — Módulos de complexidade média

**Módulos:**
| Módulo | Complexidade | Dependências |
|--------|-------------|-------------|
| Demitidos | Média | AD |
| CADLOGIN | Média | LDAP |
| Transferência | Média | AD, RH |

**Entregas adicionais:**
- Comunicação entre módulos via eventos (shell broadcast)
- Módulo pode solicitar dados de outro módulo via Registry API (não diretamente)
- Admin UI no `frontadmin`: listar módulos, habilitar/desabilitar, configurar roles

---

## Fase 3 — Módulos críticos

**Módulos:**
| Módulo | Complexidade | Observação |
|--------|-------------|------------|
| MDM | Alta | Chart complexo, muitas chamadas, paginação |
| AD/Usuários | Alta | Maior módulo, mais crítico para operação |
| Criação de usuário | Alta | Fluxo multi-step, validações LDAP |

**Entregas adicionais:**
- Design system completo publicado como pacote interno
- Observabilidade: cada módulo reporta métricas ao serviço central
- Rollback de módulo individual via Registry API (sem restart do shell)

---

## Fase 4 — Shell como produto completo

**Objetivo:** Shell totalmente limpo, sem conhecimento de nenhum módulo de negócio.

**Entregas:**
- Shell reduzido a ~400 linhas de App.tsx
- `@commandops/ui` com Storybook interno
- Admin UI para adicionar módulos externos via URL de manifest
- Versionamento semântico automático via CI/CD
- Documentação de SDK para criação de novos módulos por terceiros

---

## Regras de transição (todos os módulos)

1. **Nunca quebrar homologação** — o CommandOps monolítico continua rodando em paralelo até a Fase 4 estar completa e validada
2. **Módulo deve passar nos testes** antes de ser registrado no Registry
3. **Props obrigatórias sempre respeitadas:** `token`, `user`, `apiBase`
4. **CSS Modules obrigatório** — nenhum estilo global em módulo
5. **ErrorBoundary gerenciado pelo shell** — módulo não captura seus próprios erros de render
6. **Sem acesso direto entre módulos** — toda comunicação passa pelo shell ou Registry

---

## Velocidade esperada

| Fase | Duração estimada |
|------|-----------------|
| 0 | 2–3 semanas |
| 1 | 3–4 semanas |
| 2 | 4–5 semanas |
| 3 | 5–6 semanas |
| 4 | 3–4 semanas |
| **Total** | **~4 meses** |
