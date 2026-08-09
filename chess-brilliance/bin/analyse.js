#!/usr/bin/env node
/**
 * CLI: find the Brilliant moves in a PGN.
 *
 *   node bin/analyse.js game.pgn [--depth 20]
 *   cat game.pgn | node bin/analyse.js
 */
import fs from 'node:fs';
import { createEngine, analyseFen } from '../src/engine/engine-node.js';
import { analyseGame, DEFAULT_SETTINGS } from '../src/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const pgn = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
const depth = Number(arg('depth', 20));

const engine = await createEngine({ hashMb: 64 });
const adapter = { analyse: (fen, opts) => analyseFen(engine, fen, opts) };

const t0 = Date.now();
const report = await analyseGame(pgn, adapter, {
  settings: { ...DEFAULT_SETTINGS, deepDepth: depth, afterDepth: depth - 1 },
  onProgress: ({ done, total }) => process.stderr.write(`\r  analysing ${done}/${total}`),
});
process.stderr.write('\r');

const h = report.headers;
console.log(`${h.White || '?'} (${h.WhiteElo || '?'}) vs ${h.Black || '?'} (${h.BlackElo || '?'})`);
console.log(
  `${report.nPlies} plies · ${report.nCandidates} sacrifice candidates analysed · ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s at depth ${depth}\n`
);

if (!report.brilliants.length) console.log('no brilliant moves found');
for (const b of report.brilliants) {
  const f = b.features;
  console.log(
    `!! ${b.moveNumber}${b.color === 'w' ? '.' : '...'} ${b.san}  (ply ${b.ply}, score ${b.score})`
  );
  console.log(
    `   sacrifices ${f.sacGross}cp gross / ${f.sacNet}cp net · eval after ${cp(f.playedCp)} · ` +
      `best ${cp(f.bestCp)} · 2nd ${cp(f.secondCp)} · engine rank ${f.playedRank || '>5'}`
  );
}

if (process.env.SHOW_REJECTED) {
  console.log('\nrejected candidates:');
  for (const r of report.candidates.filter((c) => !c.brilliant)) {
    console.log(`   ${r.moveNumber}${r.color === 'w' ? '.' : '...'} ${r.san} – ${r.reason}`);
  }
}

engine.quit();
process.exit(0);

function cp(v) {
  if (v === null || v === undefined) return '?';
  if (Math.abs(v) >= 29800) return v > 0 ? '#' : '-#';
  return (v >= 0 ? '+' : '') + (v / 100).toFixed(2);
}
