/**
 * Browser adapter for Stockfish 17.1 Lite (single threaded WASM, ~7 MB).
 *
 * The single-threaded Lite build is used on purpose: it needs neither
 * SharedArrayBuffer nor cross-origin isolation (COOP/COEP), so the analyser
 * runs on any static host.
 */
import { collectMultiPv } from './uci.js';

/**
 * @param {string} enginePath URL of `stockfish-17.1-lite-single-*.js`
 *                            (its `.wasm` sibling must live next to it)
 */
export async function createEngine(enginePath, { hashMb = 32 } = {}) {
  const worker = new Worker(enginePath);

  const listeners = new Set();
  worker.onmessage = (e) => {
    const line = typeof e.data === 'string' ? e.data : e.data?.data;
    if (typeof line !== 'string') return;
    for (const l of [...listeners]) l(line);
  };

  const engine = {
    worker,
    onLine(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send(cmd) {
      worker.postMessage(cmd);
    },
    request(cmd, predicate, { timeoutMs = 0 } = {}) {
      return new Promise((resolve, reject) => {
        const buffer = [];
        let timer = null;
        const off = engine.onLine((line) => {
          buffer.push(line);
          if (predicate(line)) {
            off();
            if (timer) clearTimeout(timer);
            resolve(buffer);
          }
        });
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            off();
            reject(new Error(`engine timeout: ${cmd}`));
          }, timeoutMs);
        }
        worker.postMessage(cmd);
      });
    },
    quit() {
      try {
        worker.postMessage('quit');
      } catch {}
      worker.terminate();
    },
  };

  await engine.request('uci', (l) => l === 'uciok', { timeoutMs: 120000 });
  engine.send(`setoption name Hash value ${hashMb}`);
  engine.send('setoption name Threads value 1');
  await engine.request('isready', (l) => l === 'readyok', { timeoutMs: 120000 });
  return engine;
}

export async function analyseFen(engine, fen, { depth = 20, multiPv = 5, timeoutMs = 600000 } = {}) {
  engine.send(`setoption name MultiPV value ${multiPv}`);
  engine.send(`position fen ${fen}`);
  const lines = await engine.request(`go depth ${depth}`, (l) => l.startsWith('bestmove'), { timeoutMs });
  return collectMultiPv(lines, multiPv);
}
