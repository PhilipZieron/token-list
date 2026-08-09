/**
 * Runs the freechess (Chess.com replica) rule over the external corpus, giving
 * a reference detection rate that is independent of our own thresholds.
 *
 * Chess.com's published ~0.1-0.4 % figure counts Brilliants among *played*
 * moves of typical (mostly amateur) members. A corpus of 2400+ tournament
 * games is a different population, so freechess-on-the-same-corpus is the more
 * meaningful yardstick.
 */
import { buildFeatureTable } from './features.js';
import { classifyBrilliant, DEFAULT_PARAMS } from '../src/core/classify.js';
import { isBrilliantFreechess } from './baselines/freechess.js';
import { loadCache, cacheKey } from './engine-pool.js';
import { SETTINGS } from './run-engine.js';

const cache = loadCache();

function freechessInput(r) {
  const deep = cache.get(cacheKey(r.fenBefore, SETTINGS.deepDepth, SETTINGS.deepMultiPv));
  const after = cache.get(cacheKey(r.fenAfter, SETTINGS.afterDepth, SETTINGS.afterMultiPv));
  if (!deep || !after || !after.lines.length) return null;
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

function fcHits(rows) {
  let n = 0;
  for (const r of rows) {
    const input = freechessInput(r);
    try {
      if (input && isBrilliantFreechess(input)) n++;
    } catch {}
  }
  return n;
}

for (const name of ['chessigma-brilliant-benchmark.json', 'twic-external.json']) {
  const { rows, games } = buildFeatureTable([name]);
  const plies = games.reduce((a, g) => a + g.nPlies, 0);
  const labelled = games.reduce((a, g) => a + g.labels.length, 0);
  const fc = fcHits(rows);
  const ours = rows.filter(
    (r) =>
      classifyBrilliant(r, {
        ...DEFAULT_PARAMS,
        excludePromotion: true,
        excludeInCheck: true,
        excludeBothMate: true,
      }).brilliant
  ).length;
  console.log(
    `${name.padEnd(38)} ${games.length} games / ${plies} plies / ${labelled} labelled\n` +
      `   freechess rule : ${String(fc).padStart(4)} detections = ${((100 * fc) / plies).toFixed(3)} % of plies\n` +
      `   this system    : ${String(ours).padStart(4)} detections = ${((100 * ours) / plies).toFixed(3)} % of plies\n`
  );
}
