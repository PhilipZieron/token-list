/**
 * Runs the freechess (Chess.com replica) rule over exactly the same engine
 * output our classifier sees, so the two are directly comparable, and reports
 * how often they agree on the moves the benchmark does not label.
 */
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS } from '../src/core/classify.js';
import { isBrilliantFreechess } from './baselines/freechess.js';
import { loadCache, cacheKey } from './engine-pool.js';
import { SETTINGS } from './run-engine.js';

const { rows, games } = buildFeatureTable(['chessigma-brilliant-benchmark.json']);
const cache = loadCache();

/** Convert our mover-relative engine data into freechess's white-relative form. */
function freechessInput(r) {
  const deep = cache.get(cacheKey(r.fenBefore, SETTINGS.deepDepth, SETTINGS.deepMultiPv));
  const after = cache.get(cacheKey(r.fenAfter, SETTINGS.afterDepth, SETTINGS.afterMultiPv));
  if (!deep || !after) return null;
  const sign = r.color === 'w' ? 1 : -1; // mover-relative -> white-relative
  const topLines = deep.lines.map((l) => ({
    moveUCI: l.move,
    evaluation: { type: l.score.type, value: l.score.value * sign },
  }));
  const afterTop = after.lines[0];
  // fenAfter has the opponent to move, so its score is opponent-relative.
  const evaluation = { type: afterTop.score.type, value: afterTop.score.value * -sign };
  return {
    fenBefore: r.fenBefore,
    fenAfter: r.fenAfter,
    uci: r.uci,
    san: r.san,
    moveColour: r.color === 'w' ? 'white' : 'black',
    topLines,
    evaluation,
  };
}

const params = { ...DEFAULT_PARAMS, maxSecondCp: 1200 };
let ourTp = 0;
let ourFp = 0;
let fcTp = 0;
let fcFp = 0;
let agreeOnFp = 0;
const ourOnlyFp = [];

for (const r of rows) {
  const ours = classifyBrilliant(r, params).brilliant;
  const input = freechessInput(r);
  let fc = false;
  try {
    fc = input ? isBrilliantFreechess(input) : false;
  } catch {
    fc = false;
  }
  if (r.label === 1) {
    if (ours) ourTp++;
    if (fc) fcTp++;
  } else {
    if (ours) ourFp++;
    if (fc) fcFp++;
    if (ours && fc) agreeOnFp++;
    if (ours && !fc) ourOnlyFp.push(r);
  }
}

const nPlies = games.reduce((a, g) => a + g.nPlies, 0);
console.log('                               recall     extra detections (per game)');
console.log(
  `freechess (chess.com replica)  ${String(fcTp).padStart(3)}/100      ${String(fcFp).padStart(4)}  (${(fcFp / 100).toFixed(2)})`
);
console.log(
  `this system                    ${String(ourTp).padStart(3)}/100      ${String(ourFp).padStart(4)}  (${(ourFp / 100).toFixed(2)})`
);
console.log(`\ntotal plies analysed: ${nPlies}`);
console.log(
  `of our ${ourFp} unlabelled detections, freechess independently agrees on ${agreeOnFp} ` +
    `(${((100 * agreeOnFp) / Math.max(1, ourFp)).toFixed(0)}%)`
);

console.log('\nunlabelled detections freechess does NOT confirm (ours only), top 25 by score:');
for (const r of ourOnlyFp
  .sort((a, b) => classifyBrilliant(b, params).score - classifyBrilliant(a, params).score)
  .slice(0, 25)) {
  console.log(
    `  ${r.gameId.split('#')[1].padStart(3)} ply=${String(r.ply).padStart(3)} ${r.san.padEnd(7)} sac=${String(r.sacGross).padStart(3)}/${String(r.sacNet).padStart(3)} best=${String(r.bestCp).padStart(6)} 2nd=${String(r.secondCp).padStart(6)} played=${String(r.playedCp).padStart(6)} rank=${r.playedRank} recap=${r.isRecapture ? 'Y' : 'n'} chk=${r.givesCheck ? 'Y' : 'n'}`
  );
}
