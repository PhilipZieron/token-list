#!/usr/bin/env node
/**
 * `npm test` — verifies the package works end to end without needing the
 * benchmark corpora or any cached engine output. Run this after dropping the
 * package into an application to confirm the engine files resolve correctly.
 */
import assert from 'node:assert/strict';
import { see } from '../src/core/board.js';
import { replay } from '../src/core/pgn.js';
import { classifyBrilliant, PRESETS, DEFAULT_PARAMS } from '../src/core/classify.js';
import { createBrilliantAnalyser, AnalysisCancelled } from '../src/node.js';

let failed = 0;
const check = (name, fn) => {
  try {
    const r = fn();
    return r instanceof Promise
      ? r.then(
          () => console.log(`  ok   ${name}`),
          (e) => {
            failed++;
            console.log(`  FAIL ${name}: ${e.message}`);
          }
        )
      : console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
};

console.log('static exchange evaluation');
check('wins a free pawn', () => assert.equal(see('4k3/8/8/4p3/8/8/3P4/4R2K w - - 0 1', 'e1', 'e5'), 100));
check('loses the exchange', () =>
  assert.equal(see('4k3/8/5p2/4p3/8/8/8/4R2K w - - 0 1', 'e1', 'e5'), -400));
check('even trade is zero', () =>
  assert.equal(see('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1', 'b5', 'c6'), 0));
check('bishop takes defended rook', () =>
  assert.equal(see('r3k3/8/1q6/2b5/3R4/4P3/8/3RK3 b - - 0 1', 'c5', 'd4'), 200));

console.log('\nPGN handling');
const CHESSCOM_PGN = `[Event "Live Chess"]
[White "hlaifs"]
[Black "jakecake98"]
[Result "1-0"]

1. e4 {[%clk 0:05:00]} 1... c6 {[%clk 0:04:58]} 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5
5. Ng3 Bg6 6. h4 e6 7. h5 Bf5 8. Nxf5 exf5 9. Bd3 Qd5 10. Nf3 Nf6 11. Qe2+ Be7
12. Bc4 Qa5+ 13. Bd2 Qb6 14. Ne5 O-O 15. h6 g6 16. Nxg6 hxg6 17. Bc3 Kh7
18. O-O-O Ne4 19. Rd3 Re8 20. Bxf7 Rf8 21. Bxg6+ Kxg6 22. Qh5+ Kh7 23. d5 Nxf2
24. Rg3 Ng4 25. Rxg4 fxg4 26. Qe5 Rg8 27. Rf1 Bg5+ 28. Kb1 Bxh6 29. Rf7+ Rg7
30. Rxg7+ Bxg7 31. Qxg7# 1-0`;

check('clock comments are ignored', () => {
  const { plies, headers } = replay(CHESSCOM_PGN);
  assert.equal(headers.White, 'hlaifs');
  assert.equal(plies.length, 61);
  assert.equal(plies[30].san, 'Nxg6');
});
check('ply numbering is 1-based', () => {
  const { plies } = replay(CHESSCOM_PGN);
  assert.equal(plies[0].ply, 1);
  assert.equal(plies[0].color, 'w');
});

console.log('\nclassifier');
check('every preset resolves', () => {
  for (const name of Object.keys(PRESETS)) {
    const v = classifyBrilliant({ sacGross: 0 }, { ...DEFAULT_PARAMS, ...PRESETS[name] });
    assert.equal(typeof v.brilliant, 'boolean');
  }
});
check('a quiet move is never brilliant', () => {
  const v = classifyBrilliant({ sacGross: 0, sacNet: 0, playedCp: 50, bestCp: 50 });
  assert.equal(v.brilliant, false);
  assert.equal(v.reason, 'no-piece-sacrifice');
});

console.log('\nend to end (loads Stockfish 17.1 Lite — takes a minute)');
const analyser = createBrilliantAnalyser({ params: 'production' });

await check('estimate works without the engine', async () => {
  const e = analyser.estimate(CHESSCOM_PGN);
  assert.equal(e.plies, 61);
  assert.ok(e.candidates > 0 && e.candidates < e.plies);
});

await check('bad preset throws at the call site', async () => {
  assert.throws(() => analyser.analyse(CHESSCOM_PGN, { params: 'nope' }), /unknown preset/);
});

await check('finds the three Chess.com Brilliants', async () => {
  const report = await analyser.analyse(CHESSCOM_PGN);
  const found = report.brilliants.map((b) => b.san);
  for (const expected of ['Nxg6', 'Bxg6+', 'Rxg4']) {
    assert.ok(found.includes(expected), `missing ${expected}, got ${found.join(', ')}`);
  }
});

await check('cancellation is clean and the engine survives it', async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(() => analyser.analyse(CHESSCOM_PGN, { signal: ac.signal }), AnalysisCancelled);
  const after = await analyser.analyse(CHESSCOM_PGN);
  assert.ok(after.brilliants.length >= 3);
});

await analyser.dispose();
await check('disposed analyser rejects further work', async () => {
  await assert.rejects(() => analyser.analyse(CHESSCOM_PGN), /disposed/);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
