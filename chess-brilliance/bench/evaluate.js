/**
 * Scores the classifier against a labelled benchmark.
 *
 * Recall = labelled Brilliant moves we also call Brilliant.
 * FP rate = unlabelled plies we call Brilliant, over *all* plies in the same
 *           games (moves rejected by the cheap pre-filter count as negatives).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS } from '../src/core/classify.js';
import { totalPlies } from './dataset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function evaluate(rows, games, params = DEFAULT_PARAMS, { verbose = false } = {}) {
  const nPlies = totalPlies(games);
  const nPositives = games.reduce((a, g) => a + g.labels.length, 0);

  let tp = 0;
  let fp = 0;
  const misses = [];
  const falsePositives = [];

  for (const r of rows) {
    const res = classifyBrilliant(r, params);
    if (r.label === 1) {
      if (res.brilliant) tp++;
      else misses.push({ ...pick(r), reasons: res.reasons });
    } else if (res.brilliant) {
      fp++;
      falsePositives.push(pick(r));
    }
  }

  // positives that never even reached the engine stage
  const analysedPositives = rows.filter((r) => r.label === 1).length;
  const lostBeforeEngine = nPositives - analysedPositives;

  return {
    nPositives,
    nPlies,
    tp,
    fp,
    recall: tp / nPositives,
    fpRate: fp / Math.max(1, nPlies - nPositives),
    fpPerGame: fp / games.length,
    precision: tp / Math.max(1, tp + fp),
    lostBeforeEngine,
    misses,
    falsePositives,
  };
}

function pick(r) {
  return {
    gameId: r.gameId,
    ply: r.ply,
    san: r.san,
    sacGross: r.sacGross,
    sacNet: r.sacNet,
    bestCp: r.bestCp,
    secondCp: r.secondCp,
    playedCp: r.playedCp,
    evalLoss: r.evalLoss,
    epLoss: r.epLoss === null ? null : Number(r.epLoss?.toFixed(4)),
    playedRank: r.playedRank,
    shallowRank: r.shallowRank,
    givesCheck: r.givesCheck,
    inCheckBefore: r.inCheckBefore,
    fenBefore: r.fenBefore,
    elo: r.elo,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const datasets = (process.env.DATASETS || 'chessigma-brilliant-benchmark.json').split(',');
  const { rows, games } = buildFeatureTable(datasets);
  const res = evaluate(rows, games);
  console.log(
    `recall ${res.tp}/${res.nPositives} (${(100 * res.recall).toFixed(0)}%)  ` +
      `FP ${res.fp} over ${res.nPlies - res.nPositives} plies (${(100 * res.fpRate).toFixed(2)}%, ${res.fpPerGame.toFixed(2)}/game)  ` +
      `precision ${(100 * res.precision).toFixed(0)}%`
  );
  if (res.lostBeforeEngine) console.log(`(${res.lostBeforeEngine} positives never reached the engine)`);
  console.log('\nmisses:');
  for (const m of res.misses) console.log(' ', JSON.stringify(m));
}
