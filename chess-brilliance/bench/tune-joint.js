/**
 * Joint tuning: maximise recall on the labelled benchmark **subject to** the
 * detection rate on an external, unlabelled corpus of ordinary games.
 *
 * Using an external rate as the constraint is what stops the search from
 * degenerating into "call every sacrifice brilliant" — the benchmark alone
 * cannot punish that, because it only contains positives.
 *
 * The freechess (Chess.com replica) rule on the same corpus is the reference
 * point: it is the most selective published approximation, and its rate is the
 * yardstick our own rate is expressed in.
 */
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS } from '../src/core/classify.js';
import { score } from './tune.js';

const GRID = {
  minSacGross: [300],
  minSacNet: [100, 200],
  maxEpLoss: [0.04, 0.06, 0.09, 0.12],
  minPlayedCp: [-80, -30, 0, 60, 120],
  maxSecondCp: [400, 550, 700, 900],
  maxRank: [0, 3, 5],
  excludeInCheck: [true],
  excludePromotion: [true],
  excludeBothMate: [false, true],
  excludeKingMove: [false, true],
  excludeRecapture: [false, true],
};

function* combos(grid) {
  const keys = Object.keys(grid);
  const idx = keys.map(() => 0);
  for (;;) {
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

const bench = buildFeatureTable(['chessigma-brilliant-benchmark.json']);
const ext = buildFeatureTable(['twic-external.json']);
const extPlies = ext.games.reduce((a, g) => a + g.nPlies, 0);

function subset(t, parity) {
  const ids = new Set(t.games.filter((g) => Number(g.id.split('#')[1]) % 2 === parity).map((g) => g.id));
  return { rows: t.rows.filter((r) => ids.has(r.gameId)), games: t.games.filter((g) => ids.has(g.id)) };
}
const folds = [subset(bench, 0), subset(bench, 1)];

const results = [];
for (const c of combos(GRID)) {
  const params = { ...DEFAULT_PARAMS, ...c };
  const s = score(bench.rows, bench.games, params);
  let hits = 0;
  for (const r of ext.rows) if (classifyBrilliant(r, params).brilliant) hits++;
  results.push({ params: c, tp: s.tp, fp: s.fp, extRate: (100 * hits) / extPlies, extHits: hits });
}

// Pareto frontier: highest benchmark recall at each external rate.
results.sort((a, b) => b.tp - a.tp || a.extRate - b.extRate);
const frontier = [];
let bestRate = Infinity;
for (const r of results) {
  if (r.extRate < bestRate) {
    frontier.push(r);
    bestRate = r.extRate;
  }
}

console.log(`external corpus: ${ext.games.length} games / ${extPlies} plies`);
console.log('freechess reference rate on the same corpus: 0.448 %\n');
console.log('bench recall  CV recall   ext rate   x freechess   params');
for (const r of frontier) {
  const params = { ...DEFAULT_PARAMS, ...r.params };
  let cv = 0;
  let n = 0;
  for (const f of folds) {
    const s = score(f.rows, f.games, params);
    cv += s.tp;
    n += s.nPositives;
  }
  console.log(
    `${String(r.tp).padStart(6)}/100  ${String(cv).padStart(6)}/${n}   ${r.extRate.toFixed(3)} %    ${(r.extRate / 0.448).toFixed(1)}x        ${short(r.params)}`
  );
}

function short(p) {
  return (
    Object.entries(p)
      .filter(([k, v]) => DEFAULT_PARAMS[k] !== v)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ') || '(defaults)'
  );
}
