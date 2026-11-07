// Métricas internas do processo (GET /api/metrics).
// Apenas contagens e tempos: rss, heap, handles, uptime, event-loop lag, clientes SSE ativos e
// quantos transcripts foram lidos do histórico (cache + leituras a frio). O objetivo é fornecer
// um ponto único para confirmar, com medições reais, que uma correção em particular melhorou
// o consumo do escritório sem precisar de um agente externo (a UI exibe em /diagnóstico).
// A trava do terminal NÃO se aplica aqui: é só leitura, igual a /api/health.
import { performance } from 'node:perf_hooks';
import type { ServerResponse } from 'node:http';
import { existsSync, statfsSync } from 'node:fs';
import { tr } from '../../shared/i18n';
import type { Hub } from './sse';
import { errMsg, log } from '../log';

type Send = (res: ServerResponse, status: number, body: unknown) => void;

/** Contadores do histórico do terminal que a rota lê a cada requisição. */
export interface HistoryStats {
  reads: number;
  cacheSize: number;
}

/**
 * Visão ao vivo do histórico: cada leitura de `reads`/`cacheSize` consulta a fonte naquele instante. Copiar os números
 * ao montar as dependências os congelaria no valor da partida.
 */
export function liveHistory(source: HistoryStats): HistoryStats {
  return {
    get reads() {
      return source.reads;
    },
    get cacheSize() {
      return source.cacheSize;
    },
  };
}

export interface MetricsDeps {
  hub: Hub;
  /** Leituras e tamanho do cache do histórico do terminal (SessionHistory); passar por `liveHistory`. */
  history?: HistoryStats;
  /** Sobe após um `addMain`/`addSub`. */
  counts: () => { agents: number; subs: number; rooms: number; accounts: number };
  startedAt: number;
}

/** Limites da janela móvel do event-loop lag (ms). */
const LAG_WINDOW = 50;
/** Bytes a serem mostrados em MB com uma casa. */
export const toMB = (b: number): number => Math.round((b / (1024 * 1024)) * 10) / 10;

interface LagState {
  samples: number[];
  idx: number;
  filled: boolean;
  lastCheck: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Janela móvel de medições do event-loop lag; usa `performance.now()` em setTimeout. */
function lagState(): LagState {
  return {
    samples: new Array(LAG_WINDOW).fill(0),
    idx: 0,
    filled: false,
    lastCheck: performance.now(),
    timer: null,
  };
}

/** Substitui o timer antigo e agenda a próxima medição. */
function tickLag(state: LagState): void {
  if (state.timer) clearTimeout(state.timer);
  const now = performance.now();
  const drift = now - state.lastCheck - 1000; // 1s de medição
  state.samples[state.idx] = drift < 0 ? 0 : drift;
  state.idx = (state.idx + 1) % LAG_WINDOW;
  if (state.idx === 0) state.filled = true;
  state.lastCheck = now;
  state.timer = setTimeout(() => tickLag(state), 1000);
  state.timer.unref?.();
}

/** p50/p95/p99/max da janela (ms). Quando há menos de 5 amostras, devolve zeros. */
function summarize(state: LagState): { p50: number; p95: number; p99: number; max: number; samples: number } {
  const n = state.filled ? LAG_WINDOW : state.idx;
  if (n < 5) return { p50: 0, p95: 0, p99: 0, max: 0, samples: n };
  const sorted = state.samples.slice(0, n).sort((a, b) => a - b);
  const pick = (q: number): number => sorted[Math.min(n - 1, Math.floor(n * q))];
  return { p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: sorted[n - 1], samples: n };
}

/** Bytes livres no volume onde o Habblaud guarda o snapshot (o cwd do processo, se existir). */
function freeBytesAt(cwd: string): number | undefined {
  try {
    if (!existsSync(cwd)) return undefined;
    return statfsSync(cwd).bsize * statfsSync(cwd).bavail;
  } catch {
    return undefined;
  }
}

/** Identifica o estado persistente entre chamadas. Mantido por closure do módulo. */
const lag = lagState();
let started = false;

function ensureLagRunning(): void {
  if (started) return;
  started = true;
  // Primeira medição já registra `lastCheck`; a próxima cai 1s depois.
  lag.lastCheck = performance.now();
  lag.timer = setTimeout(() => tickLag(lag), 1000);
  lag.timer.unref?.();
}

/** Atende GET /api/metrics. */
export function handleMetricsRoute(res: ServerResponse, deps: MetricsDeps, send: Send): void {
  try {
    ensureLagRunning();
    const mu = process.memoryUsage();
    const cpu = process.cpuUsage();
    const c = deps.counts();
    const lagSum = summarize(lag);
    const body: Record<string, unknown> = {
      ok: true,
      uptime: Math.round((Date.now() - deps.startedAt) / 1000),
      pid: process.pid,
      node: process.version,
      // RSS é o que o sistema realmente mantém para o processo; heap é o que o V8 reservou.
      rss: toMB(mu.rss),
      heapUsed: toMB(mu.heapUsed),
      heapTotal: toMB(mu.heapTotal),
      external: toMB(mu.external),
      cpuUser: Math.round(cpu.user / 1000),
      cpuSystem: Math.round(cpu.system / 1000),
      // O event-loop lag mostra o quanto o servidor "trava" quando há trabalho demais.
      eventLoop: lagSum,
      sse: { clients: deps.hub.size, local: deps.hub.localSize },
      agents: c.agents,
      subagents: c.subs,
      rooms: c.rooms,
      accounts: c.accounts,
      // O Habblaud tem 1 história por agente; o cache vive em memória enquanto a sessão não cai da janela.
      history: deps.history
        ? { reads: deps.history.reads, cacheSize: deps.history.cacheSize }
        : { reads: 0, cacheSize: 0 },
    };
    const free = freeBytesAt(process.cwd());
    if (free !== undefined) body.diskFree = toMB(free);
    send(res, 200, body);
  } catch (err) {
    log.warnOnce(`metrics:${errMsg(err)}`, tr('Métricas: falha ao medir o processo ({0}).', [errMsg(err)]));
    send(res, 500, { ok: false, error: tr('não foi possível medir o processo') });
  }
}
