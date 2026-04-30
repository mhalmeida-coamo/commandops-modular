# Plano de migração para Go (substituindo backends Python)

## Objetivo
Migrar os backends dos módulos para Go sem interromper a plataforma atual, mantendo contratos de API e autenticação.

## Estratégia
1. Rodar em paralelo (`python` e `go`) por módulo.
2. Validar paridade funcional com testes de contrato.
3. Fazer cutover por serviço no `docker-compose`.
4. Remover Python somente após janela de estabilização.

## Ordem recomendada
1. `modules/vpn` (baixo risco, escopo menor)
2. `registry` e `services/adworker` (críticos)

## Critérios de pronto por módulo
- Endpoints e payloads com paridade.
- Mesmos códigos HTTP em erros comuns (401/403/503/504/502).
- Healthcheck equivalente.
- Logs estruturados mínimos para operação.
- Testes automatizados passando para fluxos críticos.

## Fase 1: VPN (concluída)
Backend Go aplicado como implementação principal do serviço `vpn` no `docker-compose.yml`.

Base Go em `modules/vpn/backend` com:
- `GET /health`
- `GET /api/vpn/status`
- `POST /api/vpn/process`
- Auth JWT HS256 compatível
- Cache de settings via Registry
- Integração com AD Worker

## Fase 2: Testes de contrato
- Criar suíte de contrato que execute contra backend Python e backend Go.
- Validar igualdade de shape JSON e status codes.
- Script criado: `scripts/contract-test-vpn.sh`
- Execução padrão:
  - `cd /opt/commandops-modular && ./scripts/contract-test-vpn.sh`

## Fase 3: Cutover controlado
1. Publicar imagem `vpn-go`.
2. Subir serviço paralelo (`vpn_go`) em porta interna separada.
3. Ajustar gateway para canário (ex.: 10% tráfego).
4. Monitorar erro/latência por 24-72h.
5. Completar corte para 100%.

Status atual:
- Cutover 100% do módulo VPN concluído em ambiente de desenvolvimento.

## Fase 4: Limpeza
- Remover backend Python do módulo migrado.
- Atualizar docs operacionais e troubleshooting.

## Riscos e mitigação
- Diferença de validação de payload: usar testes de contrato antes do corte.
- Diferença de CORS/Auth: checklist explícito por endpoint.
- Dependências AD/SMB: homologar com ambiente real antes do canário.

## Decisão arquitetural
- Frontend permanece em TypeScript (shell e UIs modulares).
- Go vira padrão para novos backends e substituição gradual de Python.
