/**
 * Calibration on an *external, unlabelled* corpus (TWIC tournament games).
 *
 * Chess.com's published player statistics put Brilliant moves at roughly
 * 0.1-0.4 % of all moves played. A detector that agrees with Chess.com must
 * land in that ballpark on ordinary games; a detector that has been overfitted
 * to a benchmark of brilliancy-containing games will fire far more often.
 */
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS } from '../src/core/classify.js';
import { score } from './tune.js';

const bench = buildFeatureTable(['chessigma-brilliant-benchmark.json']);
const ext = buildFeatureTable(['twic-external.json']);

const extPlies = ext.games.reduce((a, g) => a + g.nPlies, 0);
console.log(`external corpus: ${ext.games.length} games, ${extPlies} plies, ${ext.rows.length} candidates analysed`);
console.log(`benchmark      : ${bench.games.length} games, ${bench.games.reduce((a, g) => a + g.nPlies, 0)} plies\n`);

const CONFIGS = [
  ['A  permissive (recall-max)', { maxSecondCp: 1200 }],
  ['B  + chess.com promotion rule', { maxSecondCp: 1200, excludePromotion: true }],
  ['C  + in-check rule', { excludePromotion: true, excludeInCheck: true }],
  ['D  + both-mate rule', { excludePromotion: true, excludeInCheck: true, excludeBothMate: true }],
  [
    'E  + king-move rule',
    { excludePromotion: true, excludeInCheck: true, excludeBothMate: true, excludeKingMove: true },
  ],
  [
    'F  strict (2nd<500)',
    {
      excludePromotion: true,
      excludeInCheck: true,
      excludeBothMate: true,
      excludeKingMove: true,
      maxSecondCp: 500,
    },
  ],
  [
    'G  very strict (epLoss<0.05)',
    {
      excludePromotion: true,
      excludeInCheck: true,
      excludeBothMate: true,
      excludeKingMove: true,
      maxSecondCp: 500,
      maxEpLoss: 0.05,
    },
  ],
];

console.log(
  'config                          bench recall  bench extra/game   external hits  % of external moves'
);
for (const [name, patch] of CONFIGS) {
  const params = { ...DEFAULT_PARAMS, ...patch };
  const b = score(bench.rows, bench.games, params);
  let hits = 0;
  for (const r of ext.rows) if (classifyBrilliant(r, params).brilliant) hits++;
  const pct = (100 * hits) / extPlies;
  console.log(
    `${name.padEnd(32)}${String(b.tp).padStart(3)}/100        ${(b.fp / 100).toFixed(2)}          ` +
      `${String(hits).padStart(5)}          ${pct.toFixed(3)} %${pct >= 0.1 && pct <= 0.45 ? '   <- chess.com range' : ''}`
  );
}
