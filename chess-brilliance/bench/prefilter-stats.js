/**
 * Measures the engine-free sacrifice pre-filter:
 *   - recall on the 100 labelled Brilliant moves
 *   - firing rate over every other ply in the same 100 games (candidate load)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay } from '../src/core/pgn.js';
import { materialFeatures, isSacrificeCandidate } from '../src/core/features.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bench = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/chessigma-brilliant-benchmark.json'), 'utf8')
);

const posHist = new Map();
let posHit = 0;
let negTotal = 0;
let negHit = 0;
const misses = [];

for (let g = 0; g < bench.length; g++) {
  const { plies } = replay(bench[g].pgn);
  for (const p of plies) {
    const mf = materialFeatures(p.fenBefore, p.fenAfter, p.move);
    const cand = isSacrificeCandidate(mf);
    const isLabel = p.ply === bench[g].ply;
    if (isLabel) {
      posHist.set(mf.sacGross, (posHist.get(mf.sacGross) || 0) + 1);
      if (cand) posHit++;
      else misses.push({ g, ply: p.ply, san: p.san, mf });
    } else {
      negTotal++;
      if (cand) negHit++;
    }
  }
}

console.log(`positives kept by pre-filter: ${posHit}/${bench.length}`);
console.log(`negatives kept by pre-filter: ${negHit}/${negTotal} (${((100 * negHit) / negTotal).toFixed(1)}%)`);
console.log('\nsacGross histogram over positives:');
for (const [v, n] of [...posHist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(v).padStart(4)}cp : ${'#'.repeat(n)} ${n}`);
}
if (misses.length) {
  console.log('\nmissed positives:');
  for (const m of misses) console.log(` game#${m.g} ply=${m.ply} ${m.san}`, JSON.stringify(m.mf));
}
