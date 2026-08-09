import { Chess } from 'chess.js';

/**
 * Minimal, tolerant PGN reader for the single-game PGNs used by the benchmark
 * (chess.com exports with `{[%clk ...]}` comments and header tags).
 *
 * Returns { headers, moves } where `moves` is the list of SAN tokens in order.
 */
export function parsePgn(pgn) {
  // Comments may contain `]` (e.g. `{[%clk 0:02:59.9]}`), so strip them before
  // locating the header block.
  const clean = pgn.replace(/\{[^}]*\}/g, ' ');

  const headers = {};
  const headerRe = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/gm;
  let m;
  let headerEnd = 0;
  while ((m = headerRe.exec(clean)) !== null) {
    headers[m[1]] = m[2];
    headerEnd = headerRe.lastIndex;
  }

  let body = clean.slice(headerEnd);

  body = body
    .replace(/;[^\n]*/g, ' ') // rest-of-line comments
    .replace(/\$\d+/g, ' ') // NAGs
    .replace(/\d+\.(\.\.)?/g, ' ') // move numbers
    .replace(/\s+/g, ' ')
    .trim();

  // Strip recursive variations (not present in chess.com exports, but be safe).
  body = stripVariations(body);

  const tokens = body
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !['1-0', '0-1', '1/2-1/2', '*'].includes(t));

  return { headers, moves: tokens };
}

function stripVariations(s) {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/**
 * Replays a PGN and returns one record per ply.
 *
 * Ply numbering here is 1-based (ply 1 = White's first move), matching the
 * convention used by the Chessigma benchmark file.
 */
export function replay(pgn) {
  const { headers, moves } = parsePgn(pgn);
  const chess = new Chess();
  const plies = [];

  for (let i = 0; i < moves.length; i++) {
    const fenBefore = chess.fen();
    let move;
    try {
      move = chess.move(moves[i]);
    } catch {
      break; // malformed tail – keep what we have
    }
    if (!move) break;
    plies.push({
      ply: i + 1,
      san: move.san,
      uci: move.from + move.to + (move.promotion || ''),
      color: move.color,
      move,
      fenBefore,
      fenAfter: chess.fen(),
    });
  }

  return { headers, plies };
}

export function fenList(plies) {
  if (plies.length === 0) return [];
  return [plies[0].fenBefore, ...plies.map((p) => p.fenAfter)];
}
