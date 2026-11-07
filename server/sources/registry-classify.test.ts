import { describe, it, expect } from 'vitest';
import { classifyAgent, classifyAgents, classifyAll, getRunState, getSessionOrigin, getAgentRole, isTempPath, type ClassifiableEntry } from './registry-classify';
import os from 'node:os';

const base = (): ClassifiableEntry => ({
  id: 'a1',
  status: 'running',
  startedAt: 1_000,
  firstSeenAt: 1_000,
  lastEventAt: 5_000,
  finishedAt: null,
  cwd: '/Users/me/projeto',
});

// ---------------------------------------------------------------- runState

describe('getRunState', () => {
  it('retorna ACTIVE quando finishedAt é null e lastEventAt é recente', () => {
    const e = { ...base(), lastEventAt: 9_000 };
    expect(getRunState(e, { now: () => 10_000, idleAfterMs: 30_000 })).toBe('ACTIVE');
  });

  it('retorna IDLE quando finishedAt é null e lastEventAt é antigo', () => {
    const e = { ...base(), lastEventAt: 1_000 };
    expect(getRunState(e, { now: () => 60_000, idleAfterMs: 30_000 })).toBe('IDLE');
  });

  it('retorna IDLE quando lastEventAt é 0 (nunca emitiu)', () => {
    const e = { ...base(), lastEventAt: 0 };
    expect(getRunState(e, { now: () => 10_000 })).toBe('IDLE');
  });

  it('retorna HISTORICAL quando finishedAt é definido', () => {
    const e = { ...base(), finishedAt: 8_000 };
    expect(getRunState(e, { now: () => 10_000 })).toBe('HISTORICAL');
  });

  it('retorna UNKNOWN quando startedAt é 0', () => {
    const e = { ...base(), startedAt: 0 };
    expect(getRunState(e, { now: () => 10_000 })).toBe('UNKNOWN');
  });

  it('retorna UNKNOWN quando startedAt é NaN', () => {
    const e = { ...base(), startedAt: NaN };
    expect(getRunState(e, { now: () => 10_000 })).toBe('UNKNOWN');
  });

  it('borda: agora - lastEventAt === idleAfterMs ainda é ACTIVE', () => {
    const e = { ...base(), lastEventAt: 5_000 };
    expect(getRunState(e, { now: () => 35_000, idleAfterMs: 30_000 })).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------- sessionOrigin

describe('getSessionOrigin', () => {
  it('retorna PROJECT para cwd normal', () => {
    const e = { ...base(), cwd: '/Users/me/projeto' };
    expect(getSessionOrigin(e)).toBe('PROJECT');
  });

  it('retorna TEMP para cwd em /tmp', () => {
    const e = { ...base(), cwd: '/tmp/projeto-x' };
    expect(getSessionOrigin(e)).toBe('TEMP');
  });

  it('retorna TEMP para cwd em os.tmpdir()', () => {
    const e = { ...base(), cwd: `${os.tmpdir()}/sess-42` };
    expect(getSessionOrigin(e)).toBe('TEMP');
  });

  it('retorna UNKNOWN quando cwd é undefined', () => {
    const e = { ...base(), cwd: undefined };
    expect(getSessionOrigin(e)).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------- agentRole

describe('getAgentRole', () => {
  it('retorna MAIN quando parent é undefined', () => {
    const e = { ...base(), parent: undefined };
    expect(getAgentRole(e)).toBe('MAIN');
  });

  it('retorna SUBAGENT quando parent é definido', () => {
    const e = { ...base(), parent: 'parent-123' };
    expect(getAgentRole(e)).toBe('SUBAGENT');
  });
});

// ---------------------------------------------------------------- classifyAll

describe('classifyAll', () => {
  it('retorna todas as dimensões para agente ativo', () => {
    const e = { ...base(), lastEventAt: 9_000, parent: undefined };
    const result = classifyAll(e, { now: () => 10_000, idleAfterMs: 30_000 });
    expect(result.runState).toBe('ACTIVE');
    expect(result.sessionOrigin).toBe('PROJECT');
    expect(result.agentRole).toBe('MAIN');
  });

  it('retorna todas as dimensões para subagente histórico', () => {
    const e = { ...base(), finishedAt: 8_000, cwd: '/tmp/sub', parent: 'parent-123' };
    const result = classifyAll(e, { now: () => 10_000 });
    expect(result.runState).toBe('HISTORICAL');
    expect(result.sessionOrigin).toBe('TEMP');
    expect(result.agentRole).toBe('SUBAGENT');
  });
});

// ---------------------------------------------------------------- classifyAgent (compatibilidade)

describe('classifyAgent', () => {
  it('retorna ACTIVE quando finishedAt é null e lastEventAt é recente', () => {
    const e = { ...base(), lastEventAt: 9_000 };
    expect(classifyAgent(e, { now: () => 10_000, idleAfterMs: 30_000 })).toBe('ACTIVE');
  });

  it('retorna IDLE quando finishedAt é null e lastEventAt é antigo', () => {
    const e = { ...base(), lastEventAt: 1_000 };
    expect(classifyAgent(e, { now: () => 60_000, idleAfterMs: 30_000 })).toBe('IDLE');
  });

  it('retorna IDLE quando lastEventAt é 0 (nunca emitiu)', () => {
    const e = { ...base(), lastEventAt: 0 };
    expect(classifyAgent(e, { now: () => 10_000 })).toBe('IDLE');
  });

  it('retorna HISTORICAL quando finishedAt e cwd não é temporário', () => {
    const e = { ...base(), finishedAt: 8_000, cwd: '/Users/me/projeto' };
    expect(classifyAgent(e, { now: () => 10_000 })).toBe('HISTORICAL');
  });

  it('retorna TEMP quando finishedAt e cwd vive em /tmp', () => {
    const e = { ...base(), finishedAt: 8_000, cwd: '/tmp/projeto-x' };
    expect(classifyAgent(e, { now: () => 10_000 })).toBe('TEMP');
  });

  it('retorna TEMP quando finishedAt e cwd vive em os.tmpdir()', () => {
    const e = { ...base(), finishedAt: 8_000, cwd: `${os.tmpdir()}/sess-42` };
    expect(classifyAgent(e, { now: () => 10_000 })).toBe('TEMP');
  });

  it('retorna UNKNOWN quando startedAt é 0', () => {
    const e = { ...base(), startedAt: 0 };
    expect(classifyAgent(e, { now: () => 10_000 })).toBe('UNKNOWN');
  });

  it('retorna UNKNOWN quando startedAt é NaN', () => {
    const e = { ...base(), startedAt: NaN };
    expect(classifyAgent(e, { now: () => 10_000 })).toBe('UNKNOWN');
  });

  it('classifica borda: agora - lastEventAt === idleAfterMs ainda é ACTIVE', () => {
    const e = { ...base(), lastEventAt: 5_000 };
    expect(classifyAgent(e, { now: () => 35_000, idleAfterMs: 30_000 })).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------- classifyAgents

describe('classifyAgents', () => {
  it('preserva a ordem de entrada', () => {
    const list: ClassifiableEntry[] = [
      { ...base(), id: 'a', lastEventAt: 9_000 },
      { ...base(), id: 'b', finishedAt: 8_000, cwd: '/Users/me/projeto' },
      { ...base(), id: 'c', finishedAt: 8_000, cwd: '/tmp/x' },
    ];
    const r = classifyAgents(list, { now: () => 10_000 });
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.map((x) => x.class)).toEqual(['ACTIVE', 'HISTORICAL', 'TEMP']);
    expect(r.map((x) => x.runState)).toEqual(['ACTIVE', 'HISTORICAL', 'HISTORICAL']);
    expect(r.map((x) => x.sessionOrigin)).toEqual(['PROJECT', 'PROJECT', 'TEMP']);
  });

  it('inclui agentRole para subagentes', () => {
    const list: ClassifiableEntry[] = [
      { ...base(), id: 'a', parent: undefined },
      { ...base(), id: 'b', parent: 'parent-1' },
    ];
    const r = classifyAgents(list, { now: () => 10_000 });
    expect(r.map((x) => x.agentRole)).toEqual(['MAIN', 'SUBAGENT']);
  });
});

// ---------------------------------------------------------------- isTempPath

describe('isTempPath', () => {
  it('detecta /tmp', () => {
    expect(isTempPath('/tmp/x')).toBe(true);
    expect(isTempPath('/private/tmp/x')).toBe(true);
  });
  it('detecta /var/folders', () => {
    expect(isTempPath('/var/folders/abc/T/x')).toBe(true);
  });
  it('não confunde HOME com /tmp', () => {
    expect(isTempPath('/Users/me/Projetos/JHC')).toBe(false);
  });
  it('retorna false para undefined', () => {
    expect(isTempPath(undefined)).toBe(false);
    expect(isTempPath(null)).toBe(false);
    expect(isTempPath('')).toBe(false);
  });
});

describe('busy: trabalhando/esperando nunca é IDLE', () => {
  const old = { ...base(), lastEventAt: 1_000 };
  it('lastEventAt antigo + busy continua ACTIVE', () => {
    expect(getRunState({ ...old, busy: true }, { now: () => 600_000 })).toBe('ACTIVE');
    expect(getRunState({ ...old, busy: false }, { now: () => 600_000 })).toBe('IDLE');
  });
  it('busy não ressuscita um agente encerrado nem um startedAt inválido', () => {
    expect(getRunState({ ...old, busy: true, finishedAt: 5_000 }, { now: () => 600_000 })).toBe('HISTORICAL');
    expect(getRunState({ ...old, busy: true, startedAt: 0 }, { now: () => 600_000 })).toBe('UNKNOWN');
  });
  it('classifyAgents e classifyAgent concordam em todas as combinações', () => {
    const entries: ClassifiableEntry[] = [
      base(),
      { ...base(), id: 'b', finishedAt: 8_000 },
      { ...base(), id: 'c', finishedAt: 8_000, cwd: '/tmp/x' },
      { ...base(), id: 'd', startedAt: 0 },
      { ...base(), id: 'e', lastEventAt: 0, busy: true },
    ];
    const opts = { now: () => 10_000 };
    expect(classifyAgents(entries, opts).map((r) => r.class)).toEqual(entries.map((e) => classifyAgent(e, opts)));
    expect(classifyAgents(entries, opts).map((r) => r.class)).toEqual(['ACTIVE', 'HISTORICAL', 'TEMP', 'UNKNOWN', 'ACTIVE']);
  });
});
