/**
 * UCI protocol helpers shared by the Node and browser engine adapters.
 *
 * The engine is always Stockfish 17.1 **Lite** (single threaded NNUE WASM,
 * ~7 MB) so that the exact same binary can run inside a browser tab without
 * cross-origin isolation.
 */

export const MATE_SCORE = 30000;

/** Parse one `info ...` line into a structured object (null if uninteresting). */
export function parseInfoLine(line) {
  if (!line.startsWith('info ')) return null;
  if (line.includes('currmove')) return null;

  const out = {};
  const tokens = line.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') out.depth = Number(tokens[++i]);
    else if (t === 'seldepth') out.seldepth = Number(tokens[++i]);
    else if (t === 'multipv') out.multipv = Number(tokens[++i]);
    else if (t === 'nodes') out.nodes = Number(tokens[++i]);
    else if (t === 'nps') out.nps = Number(tokens[++i]);
    else if (t === 'score') {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      out.score = { type: kind === 'mate' ? 'mate' : 'cp', value };
    } else if (t === 'pv') {
      out.pv = tokens.slice(i + 1);
      break;
    }
  }
  if (out.depth === undefined || !out.score || !out.pv) return null;
  return out;
}

/**
 * Convert a UCI score (relative to the side to move) into a single signed
 * centipawn-ish number, still relative to the side to move.
 * Mate scores are mapped near ±MATE_SCORE so that ordering stays intact.
 */
export function scoreToCp(score) {
  if (!score) return 0;
  if (score.type === 'mate') {
    const sign = score.value >= 0 ? 1 : -1;
    return sign * (MATE_SCORE - Math.min(Math.abs(score.value), 100));
  }
  return score.value;
}

export function isMateScore(cp) {
  return Math.abs(cp) >= MATE_SCORE - 200;
}

/**
 * Chess.com's move classification works on *expected points* rather than raw
 * centipawns. This is the standard logistic mapping (Lichess/CAPS style):
 * win probability for the side to move, in [0, 1].
 */
export function cpToWinProb(cp) {
  if (isMateScore(cp)) return cp > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-0.00368208 * clamp(cp, -1500, 1500)));
}

/** Expected points in [0,1] – win probability plus half the draw share. */
export function cpToExpectedPoints(cp) {
  return cpToWinProb(cp);
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Collect the MultiPV result of a single `go depth N` search.
 * `lines` is the raw list of engine output lines for the search.
 */
export function collectMultiPv(lines, multiPv) {
  const best = new Map(); // multipv index -> deepest info
  for (const line of lines) {
    const info = parseInfoLine(line);
    if (!info) continue;
    const idx = info.multipv || 1;
    if (idx > multiPv) continue;
    const prev = best.get(idx);
    if (!prev || info.depth >= prev.depth) best.set(idx, info);
  }
  const result = [];
  for (let i = 1; i <= multiPv; i++) {
    const info = best.get(i);
    if (!info) continue;
    result.push({
      rank: i,
      depth: info.depth,
      seldepth: info.seldepth,
      nodes: info.nodes,
      move: info.pv[0],
      pv: info.pv,
      score: info.score,
      cp: scoreToCp(info.score),
    });
  }
  // Engines can report MultiPV lines slightly out of order across iterations.
  result.sort((a, b) => b.cp - a.cp);
  return result.map((r, i) => ({ ...r, rank: i + 1 }));
}
