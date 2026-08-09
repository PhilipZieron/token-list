/**
 * Node adapter for Stockfish 17.1 Lite (single threaded WASM).
 *
 * Deliberately loads the *same* artefact the browser uses
 * (`stockfish-17.1-lite-single-*.js` + `.wasm`) so benchmark numbers measured
 * here transfer to the web build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { collectMultiPv } from './uci.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function findLiteSingle() {
  const srcDir = path.join(__dirname, '../../node_modules/stockfish/src');
  const js = fs
    .readdirSync(srcDir)
    .find((f) => /^stockfish-17\.1-lite-single-[0-9a-f]+\.js$/.test(f));
  if (!js) throw new Error('stockfish 17.1 lite-single build not found');
  return {
    js: path.join(srcDir, js),
    wasm: path.join(srcDir, js.replace(/\.js$/, '.wasm')),
  };
}

export async function createEngine(options = {}) {
  const { js, wasm } = findLiteSingle();
  const INIT_ENGINE = require(js);

  const listeners = [];
  const module = {
    locateFile: (p) => (p.endsWith('.wasm') ? wasm : js),
    listener: (line) => {
      for (const l of listeners) l(line);
    },
  };

  const factory = typeof INIT_ENGINE === 'function' ? INIT_ENGINE() : INIT_ENGINE;
  await factory(module);
  // The emscripten module signals readiness through `_isReady`.
  if (module._isReady) {
    while (!module._isReady()) await sleep(5);
    delete module._isReady;
  }

  const send = (cmd) =>
    module.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) });

  const engine = {
    _module: module,
    onLine(fn) {
      listeners.push(fn);
      return () => listeners.splice(listeners.indexOf(fn), 1);
    },
    send(cmd) {
      send(cmd);
    },
    /** Send a command and resolve once `predicate(line)` is true. */
    request(cmd, predicate, { timeoutMs = 0 } = {}) {
      return new Promise((resolve, reject) => {
        const buffer = [];
        let timer = null;
        const off = engine.onLine((line) => {
          if (typeof line !== 'string') return;
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
            reject(new Error(`engine timeout after ${timeoutMs}ms for: ${cmd}`));
          }, timeoutMs);
        }
        send(cmd);
      });
    },
    quit() {
      try {
        send('quit');
      } catch {}
      try {
        module.terminate?.();
      } catch {}
    },
  };

  await engine.request('uci', (l) => l === 'uciok', { timeoutMs: 30000 });
  engine.send(`setoption name Hash value ${options.hashMb ?? 32}`);
  engine.send(`setoption name Threads value 1`);
  await engine.request('isready', (l) => l === 'readyok', { timeoutMs: 30000 });
  return engine;
}

/**
 * Run one MultiPV search on a FEN, returning the ranked lines.
 */
export async function analyseFen(engine, fen, { depth = 16, multiPv = 3, timeoutMs = 300000 } = {}) {
  engine.send(`setoption name MultiPV value ${multiPv}`);
  engine.send(`position fen ${fen}`);
  const lines = await engine.request(`go depth ${depth}`, (l) => l.startsWith('bestmove'), {
    timeoutMs,
  });
  return collectMultiPv(lines, multiPv);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
