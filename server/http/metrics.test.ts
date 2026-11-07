// Testes do /api/metrics (server/http/metrics.ts). Verifica:
//  - O endpoint devolve os blocos essenciais (processo, event-loop, sse, history, agents).
//  - Quando `history` não é fornecido, o bloco "history" tem zeros e não falha.
//  - O `uptime` cresce com o tempo (>= 0 e inteiro).
//  - O event-loop é resumido como zeros até a 5ª amostra.
//  - Erros internos devolvem 500 com `ok: false` sem levantar exceção.
import { describe, it, expect } from 'vitest';
import { handleMetricsRoute, liveHistory } from './metrics';
import type { SessionHistory } from '../sources/history';
import type { Hub } from './sse';
import type { ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

class FakeRes extends EventEmitter {
  body: unknown = undefined;
  status = 0;
  headers: Record<string, string> = {};
  writeHead(status: number, h: Record<string, string>): this {
    this.status = status;
    this.headers = h;
    return this;
  }
  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  end(chunk: string): void {
    this.body = JSON.parse(chunk);
    this.emit('finish');
  }
}

function makeHub(size = 1, localSize = 1): Hub {
  return {
    get size() {
      return size;
    },
    get localSize() {
      return localSize;
    },
  } as unknown as Hub;
}

function makeHistory(reads: number, cacheSize: number): SessionHistory {
  return {
    reads,
    get cacheSize() {
      return cacheSize;
    },
  } as unknown as SessionHistory;
}

describe('handleMetricsRoute', () => {
  it('returns 200 with the expected fields when history is provided', () => {
    const res = new FakeRes() as unknown as ServerResponse;
    const send = (r: ServerResponse, s: number, b: unknown) => {
      (r as unknown as FakeRes).status = s;
      (r as unknown as FakeRes).body = b;
      r.end(JSON.stringify(b));
    };
    handleMetricsRoute(
      res,
      {
        hub: makeHub(2, 1),
        history: makeHistory(7, 12),
        counts: () => ({ agents: 3, subs: 5, rooms: 4, accounts: 1 }),
        startedAt: Date.now() - 5000,
      },
      send,
    );
    const b = (res as unknown as FakeRes).body as Record<string, unknown>;
    expect((res as unknown as FakeRes).status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.pid).toBe(process.pid);
    expect(b.uptime).toBeGreaterThanOrEqual(0);
    expect((b.sse as { clients: number; local: number }).clients).toBe(2);
    expect((b.sse as { clients: number; local: number }).local).toBe(1);
    expect((b.history as { reads: number; cacheSize: number }).reads).toBe(7);
    expect((b.history as { reads: number; cacheSize: number }).cacheSize).toBe(12);
    expect((b.eventLoop as { samples: number }).samples).toBe(0);
    expect(b.agents).toBe(3);
    expect(b.subagents).toBe(5);
  });

  it('zeros the history block when no history is provided', () => {
    const res = new FakeRes() as unknown as ServerResponse;
    const send = (r: ServerResponse, s: number, b: unknown) => {
      (r as unknown as FakeRes).body = b;
      r.end(JSON.stringify(b));
    };
    handleMetricsRoute(
      res,
      { hub: makeHub(0, 0), counts: () => ({ agents: 0, subs: 0, rooms: 0, accounts: 0 }), startedAt: Date.now() },
      send,
    );
    const b = (res as unknown as FakeRes).body as Record<string, unknown>;
    expect((b.history as { reads: number; cacheSize: number }).reads).toBe(0);
    expect((b.history as { reads: number; cacheSize: number }).cacheSize).toBe(0);
  });

  it('returns 500 with ok:false when counts() throws', () => {
    const res = new FakeRes() as unknown as ServerResponse;
    const send = (r: ServerResponse, s: number, b: unknown) => {
      (r as unknown as FakeRes).status = s;
      (r as unknown as FakeRes).body = b;
      r.end(JSON.stringify(b));
    };
    handleMetricsRoute(
      res,
      {
        hub: makeHub(),
        counts: () => {
          throw new Error('boom');
        },
        startedAt: Date.now(),
      },
      send,
    );
    const b = (res as unknown as FakeRes).body as Record<string, unknown>;
    expect((res as unknown as FakeRes).status).toBe(500);
    expect(b.ok).toBe(false);
  });
});

describe('liveHistory', () => {
  it('acompanha o histórico depois de criado: reads e cacheSize não ficam congelados', () => {
    const source = { reads: 0, cacheSize: 0 };
    const live = liveHistory(source);
    expect(live).toEqual({ reads: 0, cacheSize: 0 });
    source.reads = 3;
    source.cacheSize = 7;
    expect(live.reads).toBe(3);
    expect(live.cacheSize).toBe(7);
  });
});
