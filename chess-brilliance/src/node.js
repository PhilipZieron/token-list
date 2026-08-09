/**
 * Node entry point — same API as the browser build, backed by the same
 * Stockfish 17.1 Lite artefact so results are identical.
 *
 *   import { createBrilliantAnalyser } from 'chess-brilliance/node';
 *   const analyser = createBrilliantAnalyser();
 *   const report = await analyser.analyse(pgn);
 *   await analyser.dispose();
 */
import { BrilliantAnalyser } from './analyser.js';
import { createEngine, analyseFen } from './engine/engine-node.js';

export { BrilliantAnalyser, AnalysisCancelled } from './analyser.js';
export { analyseGame, countCandidates, DEFAULT_SETTINGS, PRESETS, DEFAULT_PARAMS, classifyBrilliant, parsePgn, replay } from './index.js';

export function createBrilliantAnalyser({ hashMb = 64, params, settings, flavor = 'lite-single' } = {}) {
  return new BrilliantAnalyser({
    params,
    settings,
    createEngine: async () => {
      const engine = await createEngine({ hashMb, flavor });
      return {
        analyse: (fen, opts) => analyseFen(engine, fen, opts),
        quit: () => engine.quit(),
      };
    },
  });
}
