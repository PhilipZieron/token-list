/**
 * Builds an *external*, completely unseen evaluation corpus from a raw PGN
 * file (TWIC tournament games). No Brilliant labels exist for it, so it is
 * used to measure how often the detector fires on ordinary play – a direct
 * check against overfitting the 100-game benchmark.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay } from '../src/core/pgn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function splitGames(text) {
  const games = [];
  let current = [];
  let inMoves = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('[') && inMoves) {
      games.push(current.join('\n'));
      current = [];
      inMoves = false;
    }
    if (!line.startsWith('[') && line.trim()) inMoves = true;
    current.push(line);
  }
  if (current.length) games.push(current.join('\n'));
  return games.filter((g) => g.includes('[Event'));
}

const input = process.argv[2];
const output = process.argv[3];
const want = Number(process.argv[4] || 250);
const minPlies = Number(process.env.MIN_PLIES || 40);

const text = fs.readFileSync(input, 'utf8');
const raw = splitGames(text);
console.log(`${raw.length} games in ${path.basename(input)}`);

// Deterministic spread through the file rather than the first N games, so we
// do not accidentally sample a single tournament/round.
const stride = Math.max(1, Math.floor(raw.length / (want * 1.6)));
const out = [];
for (let i = 0; i < raw.length && out.length < want; i += stride) {
  const pgn = raw[i];
  try {
    const { plies, headers } = replay(pgn);
    if (plies.length < minPlies) continue;
    if (!headers.Result || headers.Result === '*') continue;
    out.push({ pgn, labelPolicy: 'unlabelled' });
  } catch {}
}

fs.writeFileSync(path.join(__dirname, '../data', output), JSON.stringify(out));
console.log(`wrote ${out.length} games -> data/${output}`);
