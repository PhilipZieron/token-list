/**
 * Joins the cached engine analysis with the static features and writes a flat
 * feature table that tuning/evaluation scripts consume without touching the
 * engine again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { buildRecords, loadDataset } from './dataset.js';
import { loadCache, cacheKey, CACHE_DIR } from './engine-pool.js';
import { SETTINGS } from './run-engine.js';
import { buildMoveFeatures } from '../src/core/analysis.js';
import { replay } from '../src/core/pgn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildFeatureTable(datasetNames, { settings = SETTINGS, limit = 0 } = {}) {
  const cache = loadCache();
  const rows = [];
  const gamesMeta = [];

  for (const name of datasetNames) {
    const games = loadDataset(name);
    const sliced = limit ? games.slice(0, limit) : games;
    const source = name.replace(/\.json$/, '');
    const { games: gs, candidates } = buildRecords(sliced, { source });
    gamesMeta.push(...gs);

    for (const c of candidates) {
      const deep = cache.get(cacheKey(c.fenBefore, settings.deepDepth, settings.deepMultiPv));
      const after = cache.get(cacheKey(c.fenAfter, settings.afterDepth, settings.afterMultiPv));
      const shallow = cache.get(cacheKey(c.fenBefore, settings.shallowDepth, settings.shallowMultiPv));
      if (!deep || !after) continue;

      const chess = new Chess();
      chess.load(c.fenBefore, { skipValidation: true });
      let move;
      try {
        move = chess.move(c.san);
      } catch {
        continue;
      }

      const f = buildMoveFeatures({
        fenBefore: c.fenBefore,
        fenAfter: c.fenAfter,
        move,
        deepLines: deep.lines,
        afterLines: after.lines,
        shallowLines: shallow?.lines,
        prevMove: c.prevMove,
      });

      rows.push({
        ...f,
        gameId: c.gameId,
        source: c.source,
        ply: c.ply,
        label: c.label,
        prefiltered: c.prefiltered,
        elo: c.elo,
        fenBefore: c.fenBefore,
        fenAfter: c.fenAfter,
      });
    }
  }

  return { rows, games: gamesMeta };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const datasets = (process.env.DATASETS || 'chessigma-brilliant-benchmark.json').split(',');
  const { rows, games } = buildFeatureTable(datasets);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = path.join(CACHE_DIR, 'features.json');
  fs.writeFileSync(out, JSON.stringify({ rows, games }, null, 0));
  const pos = rows.filter((r) => r.label === 1).length;
  console.log(`wrote ${rows.length} feature rows (${pos} positives, ${games.length} games) -> ${out}`);
}
