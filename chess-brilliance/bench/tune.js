/**
 * Threshold search with 2-fold cross-validation.
 *
 * The benchmark labels exactly one Brilliant per game, so unlabelled plies are
 * only *assumed* negative – the reported "FP" count is an upper bound on real
 * false positives. The search therefore maximises recall subject to an FP
 * budget rather than optimising a single blended score, and cross-validation
 * shows how much of the tuning survives on unseen games.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS } from '../src/core/classify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GRID = {
  minSacGross: [300],
  minSacNet: [100, 200],
  maxEpLoss: [0.05, 0.07, 0.09, 0.12],
  minPlayedCp: [-80, -30, 0],
  maxSecondCp: [500, 700, 900, 1200],
  maxRank: [0, 5],
  excludeInCheck: [false, true],
  excludeKingMove: [false, true],
  excludePromotion: [false, true],
  excludeBothMate: [false, true],
};

function* combos(grid) {
  const keys = Object.keys(grid);
  const idx = keys.map(() => 0);
  while (true) {
    const o = {};
    keys.forEach((k, i) => (o[k] = grid[k][idx[i]]));
    yield o;
    let i = keys.length - 1;
    while (i >= 0) {
      idx[i]++;
      if (idx[i] < grid[keys[i]].length) break;
      idx[i] = 0;
      i--;
    }
    if (i < 0) return;
  }
}

export function score(rows, games, params) {
  const nPositives = games.reduce((a, g) => a + g.labels.length, 0);
  const nPlies = games.reduce((a, g) => a + g.nPlies, 0);
  let tp = 0;
  let fp = 0;
  for (const r of rows) {
    const res = classifyBrilliant(r, params);
    if (!res.brilliant) continue;
    if (r.label === 1) tp++;
    else fp++;
  }
  return { tp, fp, nPositives, nPlies, recall: tp / nPositives, fpRate: fp / (nPlies - nPositives) };
}

function subset(rows, games, keep) {
  const ids = new Set(games.filter(keep).map((g) => g.id));
  return { rows: rows.filter((r) => ids.has(r.gameId)), games: games.filter((g) => ids.has(g.id)) };
}

function main() {
  const { rows, games } = buildFeatureTable(['chessigma-brilliant-benchmark.json']);
  const results = [];
  for (const c of combos(GRID)) {
    const params = { ...DEFAULT_PARAMS, ...c };
    const s = score(rows, games, params);
    results.push({ params: c, ...s });
  }

  // Pareto frontier: best recall for each FP level.
  results.sort((a, b) => b.tp - a.tp || a.fp - b.fp);
  const frontier = [];
  let bestFp = Infinity;
  for (const r of results) {
    if (r.fp < bestFp) {
      frontier.push(r);
      bestFp = r.fp;
    }
  }

  console.log('Pareto frontier (recall vs false positives), full benchmark:');
  console.log('recall  FP   fp/game  params');
  for (const r of frontier) {
    console.log(
      `${String(r.tp).padStart(3)}/100 ${String(r.fp).padStart(4)}  ${(r.fp / 100).toFixed(2)}     ${short(r.params)}`
    );
  }

  // ---- 2-fold cross-validation on the most interesting operating points ----
  const folds = [
    subset(rows, games, (g, i) => Number(g.id.split('#')[1]) % 2 === 0),
    subset(rows, games, (g) => Number(g.id.split('#')[1]) % 2 === 1),
  ];

  console.log('\n2-fold CV (tune on one half, test on the other), FP budget <= 1.2/game:');
  for (const budget of [0.6, 0.9, 1.2, 1.6]) {
    let sumRecall = 0;
    let sumFp = 0;
    const chosen = [];
    for (let f = 0; f < 2; f++) {
      const train = folds[f];
      const test = folds[1 - f];
      let best = null;
      for (const c of combos(GRID)) {
        const params = { ...DEFAULT_PARAMS, ...c };
        const s = score(train.rows, train.games, params);
        if (s.fp / train.games.length > budget) continue;
        if (!best || s.tp > best.s.tp || (s.tp === best.s.tp && s.fp < best.s.fp))
          best = { params, s };
      }
      if (!best) continue;
      const t = score(test.rows, test.games, best.params);
      chosen.push(short(best.params));
      sumRecall += t.tp;
      sumFp += t.fp;
    }
    console.log(
      `  budget ${budget.toFixed(1)}/game -> held-out recall ${sumRecall}/100, held-out FP ${sumFp} (${(sumFp / 100).toFixed(2)}/game)`
    );
    for (const c of chosen) console.log(`      ${c}`);
  }

  fs.writeFileSync(
    path.join(__dirname, '../cache/tuning.json'),
    JSON.stringify({ frontier, all: results.length }, null, 1)
  );
}

function short(p) {
  return Object.entries(p)
    .filter(([k, v]) => DEFAULT_PARAMS[k] !== v)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ') || '(defaults)';
}

if (import.meta.url === `file://${process.argv[1]}`) main();
