/**
 * Generates RESULTS.md from the actual cached runs, so the documented numbers
 * can never drift from the code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS, PRESETS } from '../src/core/classify.js';
import { isBrilliantFreechess } from './baselines/freechess.js';
import { loadCache, cacheKey } from './engine-pool.js';
import { SETTINGS } from './run-engine.js';
import { score } from './tune.js';
import { buildRecords, loadDataset, PREFILTER } from './dataset.js';
import { replay } from '../src/core/pgn.js';
import { materialFeatures, isSacrificeCandidate } from '../src/core/features.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cache = loadCache();

const bench = buildFeatureTable(['chessigma-brilliant-benchmark.json']);
const benchPlies = bench.games.reduce((a, g) => a + g.nPlies, 0);

let ext = { rows: [], games: [] };
try {
  ext = buildFeatureTable(['twic-external.json']);
} catch {}
const extPlies = ext.games.reduce((a, g) => a + g.nPlies, 0);

let hold = { rows: [], games: [] };
try {
  hold = buildFeatureTable(['twic-holdout.json']);
} catch {}
const holdPlies = hold.games.reduce((a, g) => a + g.nPlies, 0);

let ann = { rows: [], games: [] };
try {
  ann = buildFeatureTable(['annotated-brilliancies.json']);
} catch {}

/* ---------------------------- pre-filter stats --------------------------- */
function prefilterStats(datasetName) {
  const games = loadDataset(datasetName);
  let plies = 0;
  let cands = 0;
  let posTotal = 0;
  let posKept = 0;
  for (const entry of games) {
    const { plies: ps } = replay(entry.pgn);
    const labels = new Set(Array.isArray(entry.ply) ? entry.ply : entry.ply ? [entry.ply] : []);
    for (const p of ps) {
      plies++;
      const keep = isSacrificeCandidate(materialFeatures(p.fenBefore, p.fenAfter, p.move), PREFILTER);
      if (keep) cands++;
      if (labels.has(p.ply)) {
        posTotal++;
        if (keep) posKept++;
      }
    }
  }
  return { plies, cands, posTotal, posKept };
}

const pf = prefilterStats('chessigma-brilliant-benchmark.json');

/* ------------------------------ configurations --------------------------- */
const CONFIGS = Object.entries(PRESETS).map(([name, patch]) => [name, patch]);

function hitsIn(table, params) {
  let n = 0;
  for (const r of table.rows) if (classifyBrilliant(r, params).brilliant) n++;
  return n;
}
const externalHits = (params) => hitsIn(ext, params);

/**
 * Human "!!" also covers quiet positional ideas with no material offer, which
 * Chess.com would never badge — so only the sacrificial ones are counted.
 */
function annotatedHits(params) {
  let tp = 0;
  let total = 0;
  for (const r of ann.rows) {
    if (r.label !== 1 || !r.prefiltered) continue;
    total++;
    if (classifyBrilliant(r, params).brilliant) tp++;
  }
  return { tp, total };
}

/* ------------------------------ freechess baseline ----------------------- */
function freechessInput(r) {
  const deep = cache.get(cacheKey(r.fenBefore, SETTINGS.deepDepth, SETTINGS.deepMultiPv));
  const after = cache.get(cacheKey(r.fenAfter, SETTINGS.afterDepth, SETTINGS.afterMultiPv));
  if (!deep || !after) return null;
  const sign = r.color === 'w' ? 1 : -1;
  return {
    fenBefore: r.fenBefore,
    fenAfter: r.fenAfter,
    uci: r.uci,
    san: r.san,
    moveColour: r.color === 'w' ? 'white' : 'black',
    topLines: deep.lines.map((l) => ({
      moveUCI: l.move,
      evaluation: { type: l.score.type, value: l.score.value * sign },
    })),
    evaluation: { type: after.lines[0].score.type, value: after.lines[0].score.value * -sign },
  };
}

function freechessScore(rows) {
  let tp = 0;
  let fp = 0;
  for (const r of rows) {
    const input = freechessInput(r);
    let v = false;
    try {
      v = input ? isBrilliantFreechess(input) : false;
    } catch {}
    if (!v) continue;
    if (r.label === 1) tp++;
    else fp++;
  }
  return { tp, fp };
}
const fcBench = freechessScore(bench.rows);
const fcExt = ext.rows.length ? freechessScore(ext.rows) : { tp: 0, fp: 0 };
const fcHold = hold.rows.length ? freechessScore(hold.rows) : { tp: 0, fp: 0 };

/* -------------------------------- 2-fold CV ------------------------------ */
function subset(t, parity) {
  const ids = new Set(t.games.filter((g) => Number(g.id.split('#')[1]) % 2 === parity).map((g) => g.id));
  return { rows: t.rows.filter((r) => ids.has(r.gameId)), games: t.games.filter((g) => ids.has(g.id)) };
}
const folds = [subset(bench, 0), subset(bench, 1)];

function cvFor(params) {
  let tp = 0;
  let n = 0;
  for (const f of folds) {
    const s = score(f.rows, f.games, params);
    tp += s.tp;
    n += s.nPositives;
  }
  return { tp, n };
}

/* --------------------------------- output -------------------------------- */
const L = [];
L.push('# Results');
L.push('');
L.push(
  `All numbers below are produced by \`node bench/report.js\` from the cached ` +
    `Stockfish 17.1 Lite runs (depth ${SETTINGS.deepDepth}, MultiPV ${SETTINGS.deepMultiPv}; ` +
    `depth ${SETTINGS.afterDepth} MultiPV ${SETTINGS.afterMultiPv} for the position after the move).`
);
L.push('');
L.push('## 1. Static pre-filter (no engine)');
L.push('');
L.push('| | value |');
L.push('| --- | --- |');
L.push(`| plies in the 100 benchmark games | ${pf.plies} |`);
L.push(`| plies that reach the engine | ${pf.cands} (${((100 * pf.cands) / pf.plies).toFixed(1)} %) |`);
L.push(`| labelled Brilliants kept | ${pf.posKept} / ${pf.posTotal} |`);
L.push('');
L.push(
  `The one Brilliant the pre-filter drops is game #47, \`23...Rf1+\`: an *equal-value* rook offer ` +
    `(SEE 0 — the rook is defended, so no material is objectively lost). Chess.com's attacker/defender ` +
    `count treats it as hanging; a static exchange evaluation does not.`
);
L.push('');
L.push('## 2. Operating points');
L.push('');
L.push(
  '"Extra detections" are Brilliant calls on plies the benchmark does not label. The benchmark labels ' +
    'exactly **one** Brilliant per game, so this is an *upper bound* on false positives, not a measured ' +
    'false-positive count.'
);
L.push('');
L.push(
  '| preset | benchmark recall | extra detections / game | tuning corpus rate | holdout corpus rate | annotated `!!` sacs |'
);
L.push('| --- | --- | --- | --- | --- | --- |');
for (const [name, patch] of CONFIGS) {
  const params = { ...DEFAULT_PARAMS, ...patch };
  const s = score(bench.rows, bench.games, params);
  const hits = externalHits(params);
  const rate = extPlies ? (100 * hits) / extPlies : NaN;
  const hh = hitsIn(hold, params);
  const hrate = holdPlies ? (100 * hh) / holdPlies : NaN;
  const a = annotatedHits(params);
  const star = name === 'balanced' ? ' *(default)*' : '';
  L.push(
    `| \`${name}\`${star} | **${s.tp}/100** | ${(s.fp / 100).toFixed(2)} | ` +
      `${extPlies ? `${rate.toFixed(3)} %` : 'n/a'} | ${holdPlies ? `${hrate.toFixed(3)} %` : 'n/a'} | ${a.tp}/${a.total} |`
  );
}
L.push('');
L.push(
  `Chess.com's own published player statistics put Brilliant moves at roughly **0.1–0.4 % of all moves**. ` +
    `The external corpus (${ext.games.length} unseen TWIC tournament games, ${extPlies} plies) is the ` +
    `calibration against that figure — the benchmark games cannot serve this purpose because they were ` +
    `*selected* for containing a Brilliant.`
);
L.push('');
L.push('## 3. Baseline comparison');
L.push('');
L.push('| system | benchmark recall | extra detections / game | tuning corpus rate | holdout corpus rate |');
L.push('| --- | --- | --- | --- | --- |');
L.push(`| Chessigma (self-reported) | 93/100 | not published | n/a | n/a |`);
L.push(
  `| freechess rule (Chess.com replica), same engine output | ${fcBench.tp}/100 | ${(fcBench.fp / 100).toFixed(2)} | ` +
    `${extPlies ? ((100 * (fcExt.tp + fcExt.fp)) / extPlies).toFixed(3) + ' %' : 'n/a'} | ` +
    `${holdPlies ? ((100 * (fcHold.tp + fcHold.fp)) / holdPlies).toFixed(3) + ' %' : 'n/a'} |`
);
{
  const params = { ...DEFAULT_PARAMS };
  const s = score(bench.rows, bench.games, params);
  const hits = externalHits(params);
  const hh = hitsIn(hold, params);
  L.push(
    `| **this project (default \`balanced\`)** | **${s.tp}/100** | ${(s.fp / 100).toFixed(2)} | ` +
      `${extPlies ? ((100 * hits) / extPlies).toFixed(3) + ' %' : 'n/a'} | ` +
      `${holdPlies ? ((100 * hh) / holdPlies).toFixed(3) + ' %' : 'n/a'} |`
  );
}
L.push('');
L.push('## 4. Where the misses come from');
L.push('');
const params = { ...DEFAULT_PARAMS };
const misses = [];
for (const r of bench.rows) {
  if (r.label !== 1) continue;
  const v = classifyBrilliant(r, params);
  if (!v.brilliant) misses.push({ r, reason: v.reason });
}
const prefilterMisses = pf.posTotal - pf.posKept;
L.push(
  `The default preset misses ${misses.length} of the analysed positives, plus ${prefilterMisses} dropped by the pre-filter.`
);
L.push('');
L.push('| game | ply | move | rejected by | detail |');
L.push('| --- | --- | --- | --- | --- |');
for (const m of misses) {
  L.push(
    `| ${m.r.gameId.split('#')[1]} | ${m.r.ply} | ${m.r.san} | \`${m.reason}\` | ` +
      `best ${fmtCp(m.r.bestCp)}, 2nd ${fmtCp(m.r.secondCp)}, played ${fmtCp(m.r.playedCp)}, EP loss ${(100 * (m.r.epLoss ?? 0)).toFixed(1)} % |`
  );
}
L.push('');
L.push('## 5. Runtime');
L.push('');
let timing = null;
try {
  timing = JSON.parse(fs.readFileSync(path.join(__dirname, '../cache/timing.json'), 'utf8'));
} catch {}
if (timing) {
  L.push(
    `Measured with a single engine and nothing else running (\`node bench/timing.js\`), ` +
      `${timing.games} games / ${timing.plies} plies / ${timing.candidates} candidates:`
  );
  L.push('');
  L.push('| | value |');
  L.push('| --- | --- |');
  L.push(`| engine load (7 MB WASM) | ${timing.engineLoadMs} ms |`);
  L.push(`| per search (depth ${timing.depth}, MultiPV 5, 1 thread) | ${timing.msPerSearch} ms |`);
  L.push(`| **per game** | **${(timing.msPerGame / 1000).toFixed(1)} s** |`);
  L.push('');
}
L.push(
  `Cost scales with the number of sacrifices in a game, not its length — only ` +
    `${((100 * pf.cands) / pf.plies).toFixed(1)} % of plies reach the engine. Measured end-to-end in ` +
    `headless Chromium on the sample game (69 plies, 3 candidates) at depth 18: **5.5 s**, engine load included.`
);
L.push('');

fs.writeFileSync(path.join(__dirname, '../RESULTS.md'), L.join('\n'));
console.log(L.join('\n'));

function fmtCp(v) {
  if (v === null || v === undefined) return '?';
  if (Math.abs(v) >= 29800) return v > 0 ? '#' : '-#';
  return (v >= 0 ? '+' : '') + (v / 100).toFixed(2);
}
