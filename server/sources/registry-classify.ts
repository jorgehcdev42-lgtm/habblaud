// Classificação de agentes: três dimensões independentes + classificação combinada para compatibilidade.
//
// Dimensões:
//   - runState (estado de execução): ACTIVE | IDLE | HISTORICAL | UNKNOWN
//   - sessionOrigin (origem da sessão): PROJECT | TEMP | UNKNOWN
//   - agentRole (papel): MAIN | SUBAGENT | UNKNOWN
//
// Classificação combinada (agentClass):
//   - ACTIVE:     runState=ACTIVE
//   - IDLE:       runState=IDLE
//   - HISTORICAL: runState=HISTORICAL E sessionOrigin=PROJECT
//   - TEMP:       runState=HISTORICAL E sessionOrigin=TEMP
//   - UNKNOWN:    qualquer dimensão UNKNOWN ou startedAt inválido
import os from 'node:os';
import path from 'node:path';
import type { AgentClass, AgentRunState, SessionOrigin, AgentRole } from '../../shared/types';

export type { AgentClass, AgentRunState, SessionOrigin, AgentRole } from '../../shared/types';

export interface ClassifiableEntry {
  id: string;
  /** 'running' ou 'stopped' (para agentes do registry). */
  status: string;
  startedAt: number;
  firstSeenAt: number;
  lastEventAt: number;
  /** Quando encerrou (timestamp ou null se ainda ativo). */
  finishedAt: number | null;
  /** Diretório de trabalho do agente. */
  cwd?: string;
  /** ID do agente pai (para subagentes). */
  parent?: string;
  /**
   * O agente está trabalhando, esperando permissão ou rodando um comando: nunca é IDLE, por mais antigo que seja o
   * último evento (uma ferramenta longa ou uma espera por permissão não emite eventos).
   */
  busy?: boolean;
}

export interface ClassifyOptions {
  /** Em ms. Se `now - lastEventAt > idleAfterMs` e não terminou, é IDLE. Padrão: 30 s. */
  idleAfterMs?: number;
  /** Injetar `Date.now` em testes. */
  now?: () => number;
}

const DEFAULTS = Object.freeze({ idleAfterMs: 30_000 });

const TMP_PREFIXES: ReadonlyArray<string> = Object.freeze([
  os.tmpdir(),
  '/tmp',
  '/private/tmp',
  '/var/folders',
  '/private/var/folders',
]);

/** Decide se um caminho vive em diretório temporário do sistema. */
export function isTempPath(cwd: string | undefined | null): boolean {
  if (!cwd) return false;
  const resolved = path.resolve(cwd);
  return TMP_PREFIXES.some((p) => resolved === p || resolved.startsWith(p + path.sep));
}

/**
 * Estado de execução do agente.
 * - ACTIVE:      não encerrou E lastEventAt recente (< idleAfterMs).
 * - IDLE:        não encerrou, não está ocupado E lastEventAt antigo (> idleAfterMs) ou lastEventAt = 0.
 * - HISTORICAL:  encerrou (finishedAt definido).
 * - UNKNOWN:     startedAt inválido.
 */
export function getRunState(entry: ClassifiableEntry, opts: ClassifyOptions = {}): AgentRunState {
  const { idleAfterMs = DEFAULTS.idleAfterMs } = opts;
  const now = (opts.now ?? Date.now)();

  if (!Number.isFinite(entry.startedAt) || entry.startedAt <= 0) return 'UNKNOWN';

  if (entry.finishedAt != null) return 'HISTORICAL';

  if (entry.busy) return 'ACTIVE';
  if (!entry.lastEventAt || now - entry.lastEventAt > idleAfterMs) return 'IDLE';
  return 'ACTIVE';
}

/**
 * Origem/destino da sessão (onde o trabalho aconteceu).
 * - PROJECT: sessão em diretório de projeto normal.
 * - TEMP:    sessão em diretório temporário.
 * - UNKNOWN: cwd não disponível.
 */
export function getSessionOrigin(entry: ClassifiableEntry): SessionOrigin {
  if (entry.cwd === undefined) return 'UNKNOWN';
  return isTempPath(entry.cwd) ? 'TEMP' : 'PROJECT';
}

/**
 * Papel do agente na hierarquia.
 * - MAIN:    agente principal (sem parent).
 * - SUBAGENT: subagente (parent definido).
 * (O tipo AgentRole tem UNKNOWN por compatibilidade, mas a regra por parent sempre decide.)
 */
export function getAgentRole(entry: ClassifiableEntry): AgentRole {
  return entry.parent ? 'SUBAGENT' : 'MAIN';
}

/**
 * Resultado completo da classificação em três dimensões.
 */
export interface ClassifyResult {
  runState: AgentRunState;
  sessionOrigin: SessionOrigin;
  agentRole: AgentRole;
}

/**
 * Classifica o agente em todas as dimensões.
 */
export function classifyAll(entry: ClassifiableEntry, opts: ClassifyOptions = {}): ClassifyResult {
  return {
    runState: getRunState(entry, opts),
    sessionOrigin: getSessionOrigin(entry),
    agentRole: getAgentRole(entry),
  };
}

/** Combina o estado de execução e a origem na classificação de alto nível (AgentInfo.agentClass). */
export function combineClass(runState: AgentRunState, sessionOrigin: SessionOrigin): AgentClass {
  if (runState === 'HISTORICAL') return sessionOrigin === 'TEMP' ? 'TEMP' : 'HISTORICAL';
  return runState;
}

/**
 * Classificação de alto nível do agente (para compatibilidade).
 * Mantida para AgentInfo.agentClass; prefira classifyAll para novos usos.
 */
export function classifyAgent(entry: ClassifiableEntry, opts: ClassifyOptions = {}): AgentClass {
  const { runState, sessionOrigin } = classifyAll(entry, opts);
  return combineClass(runState, sessionOrigin);
}

/** Atalho para classificar uma lista inteira, preservando a ordem. */
export function classifyAgents(
  entries: ReadonlyArray<ClassifiableEntry>,
  opts: ClassifyOptions = {},
): Array<{ id: string; class: AgentClass } & ClassifyResult> {
  return entries.map((e) => {
    const r = classifyAll(e, opts);
    return { id: e.id, class: combineClass(r.runState, r.sessionOrigin), ...r };
  });
}
