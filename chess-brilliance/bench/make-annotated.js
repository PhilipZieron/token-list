/**
 * Extra *positive* set that is completely independent of the Chessigma
 * benchmark: master games in which a human annotator marked a move "!!"
 * (or NAG $3).
 *
 * Human "!!" is a broader notion than Chess.com's Brilliant badge – it also
 * covers deep positional ideas with no material offer at all – so this is used
 * as a generalisation probe, not as a hard target.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

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

/**
 * Replays a PGN keeping annotation suffixes, returning the plies whose move was
 * marked "!!" / "$3", plus a clean PGN without annotations.
 */
function findDoubleExclam(pgn) {
  const clean = pgn.replace(/\{[^}]*\}/g, ' ');
  const headerRe = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/gm;
  let m;
  let headerEnd = 0;
  const headers = {};
  while ((m = headerRe.exec(clean)) !== null) {
    headers[m[1]] = m[2];
    headerEnd = headerRe.lastIndex;
  }
  let body = clean.slice(headerEnd);
  // drop variations
  let depth = 0;
  let flat = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) flat += ch;
  }
  flat = flat
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = flat.split(' ').filter(Boolean);
  const chess = new Chess();
  const marks = [];
  const sanList = [];
  let ply = 0;
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i];
    if (['1-0', '0-1', '1/2-1/2', '*'].includes(t)) break;
    if (/^\$\d+$/.test(t)) {
      if (t === '$3' && ply > 0) marks.push(ply);
      continue;
    }
    const bang = t.endsWith('!!');
    const san = t.replace(/[!?]+$/, '');
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      break;
    }
    if (!mv) break;
    ply++;
    sanList.push(mv.san);
    if (bang) marks.push(ply);
  }
  return { headers, marks: [...new Set(marks)], sanList };
}

const outputs = [];
for (const file of process.argv.slice(3)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pgn of splitGames(text)) {
    const { headers, marks, sanList } = findDoubleExclam(pgn);
    if (!marks.length || sanList.length < 10) continue;
    const rebuilt =
      Object.entries(headers)
        .map(([k, v]) => `[${k} "${v}"]`)
        .join('\n') +
      '\n\n' +
      sanList
        .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
        .join(' ') +
      ` ${headers.Result || '*'}`;
    outputs.push({ pgn: rebuilt, ply: marks, labelPolicy: 'positives-only' });
  }
}

fs.writeFileSync(path.join(__dirname, '../data', process.argv[2]), JSON.stringify(outputs));
const nMarks = outputs.reduce((a, g) => a + g.ply.length, 0);
console.log(`wrote ${outputs.length} annotated games with ${nMarks} "!!" moves -> data/${process.argv[2]}`);
