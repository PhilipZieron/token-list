/**
 * Interactive-ish inspection helper: prints why positives were missed and what
 * the false positives look like, grouped so patterns are obvious.
 */
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS } from '../src/core/classify.js';
import { evaluate } from './evaluate.js';

const datasets = (process.env.DATASETS || 'chessigma-brilliant-benchmark.json').split(',');
const { rows, games } = buildFeatureTable(datasets);

// Which single gate rejects each missed positive? (evaluate gates in isolation)
const gates = {
  'no-piece-sacrifice': (f, p) => f.sacGross < p.minSacGross,
  'sacrifice-too-small': (f, p) => f.sacNet < p.minSacNet,
  promotion: (f, p) => p.excludePromotion && f.isPromotion,
  'was-in-check': (f, p) => p.excludeInCheck && f.inCheckBefore,
  forced: (f, p) => p.excludeForced && f.nLegalBefore <= 1,
  'not-best-enough': (f, p) =>
    !f.isBestMove && f.playedCp !== null && f.epLoss > p.maxEpLoss && f.evalLoss > p.maxCpLoss,
  'losing-after': (f, p) => f.playedCp !== null && f.playedCp < p.minPlayedCp,
  'winning-anyway': (f, p) => f.secondCp !== null && f.secondCp >= p.maxSecondCp && !f.mateSecond,
  'mate-anyway': (f, p) => p.bothMateExcluded && f.mateBefore && f.mateSecond,
};

const P = DEFAULT_PARAMS;
const pos = rows.filter((r) => r.label === 1);
const counts = {};
for (const [name, fn] of Object.entries(gates)) {
  counts[name] = pos.filter((f) => fn(f, P)).length;
}
console.log('positives rejected by each gate (in isolation):');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  if (v) console.log(`  ${k.padEnd(22)} ${v}`);
}

const res = evaluate(rows, games, P);
console.log(
  `\nbaseline: recall ${res.tp}/100  FP ${res.fp}  fpRate ${(100 * res.fpRate).toFixed(2)}%  precision ${(100 * res.precision).toFixed(0)}%`
);

console.log('\n--- false positives (sorted by sacGross desc) ---');
for (const f of res.falsePositives.sort((a, b) => b.sacGross - a.sacGross).slice(0, 40)) {
  console.log(
    `${f.gameId.padEnd(38)} ply=${String(f.ply).padStart(3)} ${f.san.padEnd(7)} sac=${String(f.sacGross).padStart(3)}/${String(f.sacNet).padStart(3)} best=${String(f.bestCp).padStart(6)} 2nd=${String(f.secondCp).padStart(6)} played=${String(f.playedCp).padStart(6)} loss=${String(f.evalLoss).padStart(4)} rank=${f.playedRank} sRank=${f.shallowRank} chk=${f.givesCheck ? 'Y' : 'n'} elo=${f.elo}`
  );
}

// distribution comparison on the key continuous features
const neg = rows.filter((r) => r.label !== 1);
const feat = ['sacGross', 'sacNet', 'bestCp', 'secondCp', 'playedCp', 'evalLoss', 'epLoss', 'shallowRank', 'playedRank'];
console.log('\n--- feature medians (positives vs negatives among candidates) ---');
for (const k of feat) {
  console.log(
    `${k.padEnd(13)} pos ${fmt(median(pos.map((r) => r[k])))}   neg ${fmt(median(neg.map((r) => r[k])))}`
  );
}

function median(a) {
  const v = a.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}
function fmt(x) {
  return String(Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x).padStart(9);
}
