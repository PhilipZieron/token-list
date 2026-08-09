/**
 * Sanity checks that do not need an engine:
 *  1. SEE unit tests.
 *  2. Determine whether the benchmark's `ply` field is 1-based or 0-based by
 *     measuring which convention yields far more sacrifice-looking moves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { replay } from '../src/core/pgn.js';
import { see, bestCaptureSee, sideToMoveFen, SAC_VALUE } from '../src/core/board.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------- SEE unit tests ---------------------------- */
const seeTests = [
  // white Rxe5 with pawn recapture: rook takes pawn, pawn takes rook => 100-500
  ['4k3/8/8/4p3/8/8/3P4/4R2K w - - 0 1', 'e1', 'e5', 100],
  ['4k3/8/5p2/4p3/8/8/8/4R2K w - - 0 1', 'e1', 'e5', 100 - 500],
  // Bxc6 dxc6: bishop for knight, even trade
  ['r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1', 'b5', 'c6', 0],
  // free hanging queen
  ['4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5', 900],
];
let seeOk = 0;
for (const [fen, from, to, expect] of seeTests) {
  const got = see(fen, from, to);
  const ok = got === expect;
  seeOk += ok ? 1 : 0;
  console.log(`SEE ${ok ? 'ok ' : 'FAIL'} ${fen.slice(0, 28)}… ${from}${to} => ${got} (expected ${expect})`);
}
console.log(`SEE tests: ${seeOk}/${seeTests.length}\n`);

/* ------------------------ ply convention detection ---------------------- */
const bench = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/chessigma-brilliant-benchmark.json'), 'utf8')
);

function sacrificeScore(plyRec) {
  if (!plyRec) return null;
  const { fenBefore, fenAfter, move } = plyRec;
  const mover = move.color;
  const opp = mover === 'w' ? 'b' : 'w';
  // (a) the move itself walks into a losing exchange
  const selfSee = move.captured ? see(fenBefore, move.from, move.to) : 0;
  // (b) after the move, the opponent can win material by force
  const oppBest = bestCaptureSee(fenAfter, opp);
  return { selfSee, oppGain: oppBest.gain, san: move.san };
}

const stats = { one: { sac: 0, big: 0, total: 0 }, zero: { sac: 0, big: 0, total: 0 } };
const samples = [];

for (const entry of bench) {
  const { plies } = replay(entry.pgn);
  const oneBased = plies[entry.ply - 1];
  const zeroBased = plies[entry.ply];
  for (const [key, rec] of [['one', oneBased], ['zero', zeroBased]]) {
    const s = sacrificeScore(rec);
    if (!s) continue;
    stats[key].total++;
    const sacrificed = Math.max(s.oppGain, -s.selfSee);
    if (sacrificed >= 100) stats[key].sac++;
    if (sacrificed >= 250) stats[key].big++;
  }
  samples.push({
    idx: samples.length,
    ply: entry.ply,
    one: oneBased && sacrificeScore(oneBased),
    zero: zeroBased && sacrificeScore(zeroBased),
  });
}

console.log('convention  moves-with-any-sac  moves-with-piece-sac  total');
for (const key of ['one', 'zero']) {
  const s = stats[key];
  console.log(
    `${key.padEnd(11)} ${String(s.sac).padStart(6)} (${((100 * s.sac) / s.total).toFixed(0)}%)      ${String(s.big).padStart(6)} (${((100 * s.big) / s.total).toFixed(0)}%)        ${s.total}`
  );
}

console.log('\nFirst 12 games (1-based vs 0-based):');
for (const s of samples.slice(0, 12)) {
  console.log(
    `#${String(s.idx).padStart(3)} ply=${String(s.ply).padStart(3)}  1based=${(s.one?.san ?? '-').padEnd(8)} sac=${String(Math.max(s.one?.oppGain ?? 0, -(s.one?.selfSee ?? 0))).padStart(4)}   0based=${(s.zero?.san ?? '-').padEnd(8)} sac=${String(Math.max(s.zero?.oppGain ?? 0, -(s.zero?.selfSee ?? 0))).padStart(4)}`
  );
}
