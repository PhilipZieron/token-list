/**
 * Single-engine timing, measured with nothing else running, so RESULTS.md can
 * quote a number that reflects what one browser tab actually does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, analyseFen } from '../src/engine/engine-node.js';
import { analyseGame, DEFAULT_SETTINGS } from '../src/index.js';
import { loadDataset } from './dataset.js';
import { CACHE_DIR } from './engine-pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const games = loadDataset('chessigma-brilliant-benchmark.json').slice(0, Number(process.env.N || 5));
const depth = Number(process.env.DEPTH || 20);

const t0 = Date.now();
const engine = await createEngine({ hashMb: 64 });
const loadMs = Date.now() - t0;
const adapter = { analyse: (fen, opts) => analyseFen(engine, fen, opts) };

let plies = 0;
let candidates = 0;
let searches = 0;
const perGame = [];
for (const g of games) {
  const s = Date.now();
  const report = await analyseGame(g.pgn, adapter, {
    settings: { ...DEFAULT_SETTINGS, deepDepth: depth, afterDepth: depth - 1 },
  });
  const ms = Date.now() - s;
  plies += report.nPlies;
  candidates += report.nCandidates;
  searches += report.nCandidates * 2;
  perGame.push({ plies: report.nPlies, candidates: report.nCandidates, ms });
  console.log(`${report.nPlies} plies, ${report.nCandidates} candidates -> ${(ms / 1000).toFixed(1)}s`);
}
engine.quit();

const totalMs = perGame.reduce((a, g) => a + g.ms, 0);
const out = {
  depth,
  engineLoadMs: loadMs,
  games: games.length,
  plies,
  candidates,
  searches,
  totalMs,
  msPerGame: Math.round(totalMs / games.length),
  msPerSearch: Math.round(totalMs / Math.max(1, searches)),
};
fs.writeFileSync(path.join(CACHE_DIR, 'timing.json'), JSON.stringify(out, null, 1));
console.log(
  `\n${games.length} games, ${plies} plies, ${candidates} candidates, ${searches} searches\n` +
    `engine load ${loadMs} ms · ${(out.msPerGame / 1000).toFixed(1)} s per game · ${out.msPerSearch} ms per search (depth ${depth}, single thread)`
);
process.exit(0);
