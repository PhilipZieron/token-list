/**
 * Browser entry point — the only import an application needs.
 *
 *   import { createBrilliantAnalyser } from 'chess-brilliance/browser';
 *
 *   const analyser = createBrilliantAnalyser({
 *     enginePath: '/engine/stockfish-17.1-lite-single.js',
 *   });
 *   const report = await analyser.analyse(pgn, { onProgress: p => … });
 *
 * The `.wasm` file must sit next to the `.js` file; the Stockfish build finds
 * it by itself. Both come from `node_modules/stockfish/src/`.
 */
import { BrilliantAnalyser } from './analyser.js';
import { createEngine, analyseFen } from './engine/engine-browser.js';

export { BrilliantAnalyser, AnalysisCancelled } from './analyser.js';
export { analyseGame, countCandidates, DEFAULT_SETTINGS, PRESETS, DEFAULT_PARAMS, classifyBrilliant, parsePgn, replay } from './index.js';

/**
 * @param {object} options
 * @param {string} options.enginePath  URL of stockfish-17.1-lite-single-*.js
 * @param {number} [options.hashMb]    engine hash table, default 32
 * @param {object|string} [options.params]   preset name, default 'production'
 * @param {object} [options.settings]
 */
export function createBrilliantAnalyser({ enginePath, hashMb = 32, params, settings } = {}) {
  if (!enginePath) throw new TypeError('createBrilliantAnalyser needs an enginePath');
  return new BrilliantAnalyser({
    params,
    settings,
    createEngine: async () => {
      const engine = await createEngine(enginePath, { hashMb });
      return {
        analyse: (fen, opts) => analyseFen(engine, fen, opts),
        quit: () => engine.quit(),
      };
    },
  });
}
