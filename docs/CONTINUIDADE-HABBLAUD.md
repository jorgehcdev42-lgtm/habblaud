# CONTINUIDADE-HABBLAUD — checkpoint 2026-11-07

Lido primeiro por quem retoma o trabalho. Substitui o checkpoint de 2026-10-30 (feito dentro de um sandbox que
bloqueava vitest/vite; vários itens dele estão superados aqui).

## Onde estamos

- **Base:** Habblaud 1.0.3 oficial (`faa1a01`), branch `claude/projeto-continuacao-autonoma-decbc1`.
- **Personalizações do Dr. Jorge HC**, antes só como alterações *não commitadas* no checkout principal
  (`/Users/djjorgehc/habblaud`, branch `integrate-v1.0.3`), agora **commitadas e verificadas** nesta branch:
  - classificador de agentes em três dimensões (`server/sources/registry-classify.ts`): `runState`
    (ACTIVE/IDLE/HISTORICAL/UNKNOWN), `sessionOrigin` (PROJECT/TEMP/UNKNOWN), `agentRole` (MAIN/SUBAGENT) e a classe
    combinada `agentClass`; calculado em `Office.build()` para agentes reais **e do demo**;
  - filtros por estado na barra lateral (Todos, Ativos, Ociosos, Históricos, Subagentes, Temporários) em
    `client/src/ui/model.ts` + `sidebar.ts`;
  - `GET /api/metrics` (`server/http/metrics.ts`): RSS/heap, uptime, atraso do laço de eventos, SSE, contagens, cache do
    histórico.
- O checkout principal **não foi alterado** (nada apagado). Os arquivos de diagnóstico dele (`test-*.ts` na raiz,
  `*.sandbox-test.ts`, `*.nodetest.ts`, `_sse-real-in-project.test.ts`, `auditoria-*.md`, `fase3-*.md`) eram
  gambiarras do sandbox; **não** foram trazidos pra cá. Os testes reais estão em vitest.

## O que mudou em relação ao que veio do sandbox

- `busy`: agente `working`/`waiting`/`shell` nunca é IDLE (antes, esperar permissão por mais de 30 s virava "ocioso" e
  sumia do filtro "Ativos").
- Código morto removido do cliente (tabelas de rótulo/cor sem uso, casts inúteis); cores dos filtros agora são tokens do
  tema (`--st-*`), sem hex fixo.
- `http.test.ts`: o teste de SSE agora espera o evento `feed` inteiro (antes dava match no snapshot seguinte; o
  workaround com timer de 100 ms foi descartado).
- i18n completo (en/es/fr), `CHANGELOG.md` em "Não lançado" e a rota nova nos 4 READMEs.

## Verificação (2026-11-07)

| Item | Resultado |
|------|-----------|
| `npm run typecheck` | limpo |
| `npm run i18n:check` | 2990/2990 em en, es e fr |
| `npm run build` | ok |
| `npm test` | ~1917 verdes; sobram só testes **sensíveis à carga da máquina** (ver abaixo) |
| Servidor do build em demo | `/api/metrics` responde; agentes saem classificados |

### Testes que falham por carga (não por código)

Com load average 20–40 (WebKit/WindowServer consumindo CPU) falham, de forma intermitente: `server/world/uplink.test.ts`
(falha **também no v1.0.3 puro**, provado em worktree limpo), `server/messages/codex.test.ts` (prazo de 400 ms pra um
binário falso), e às vezes `server/test/codex-hook`, `permission-hook`, `build.test`, `art.test`. Passam com a máquina
folgada ou com `npx vitest run <arquivo> --maxWorkers=1`. Dica: fechar apps pesados antes de rodar a suíte.

## Próximos passos sugeridos

1. Rodar `npm test` com a máquina folgada pra fechar a suíte 100% verde.
2. Medir o consumo real com `/api/metrics` (o Habblaud nativo ficava em ~530 MB RSS segundo o checkpoint antigo;
   no demo recém-iniciado são ~58 MB) e só então decidir sobre um "Modo Econômico" — não inventar knobs sem medição.
3. Paginar/virtualizar a lista da barra lateral se houver muitos agentes (hoje a lista inteira é renderizada).
4. `.env` com `HABBLAUD_CODEX=0` existe só no checkout principal (não versionado, de propósito).
5. Instância residual na porta 4747 (PID 25839, do checkpoint antigo): encerrar à mão com `kill 25839` se ainda existir.

## Regras que continuam valendo

- `shared/world/` e `server/world/`: **não modificar** para enviar dados que não reflitam o escritório real (Termos do
  Habblaud World; ver `CLAUDE.md`). Nada disso foi tocado.
- Todo texto visível passa por `tr('...')` e entra nas traduções; toda mudança visível entra no `CHANGELOG.md`.
