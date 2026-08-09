import { Chess } from 'chess.js';

export const PIECE_VALUE = { p: 100, n: 305, b: 333, r: 563, q: 950, k: 100000 };
/** Coarse values used for "is this a sacrifice" reasoning (classic 1/3/3/5/9). */
export const SAC_VALUE = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 100000 };

const FILES = 'abcdefgh';

export function sq(file, rank) {
  return FILES[file] + (rank + 1);
}
export function squareToXY(square) {
  return { x: FILES.indexOf(square[0]), y: Number(square[1]) - 1 };
}

/** Material balance (mover-relative) in centipawns, pawns included. */
export function materialBalance(chess, color) {
  let total = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.type === 'k') continue;
      total += (p.color === color ? 1 : -1) * SAC_VALUE[p.type];
    }
  }
  return total;
}

/** All pseudo-legal-ish attackers of `square` belonging to `byColor`. */
export function attackersOf(fen, square, byColor) {
  const board = new Chess();
  // Force side to move + clear en-passant so chess.js generates the captures we want.
  board.load(sideToMoveFen(fen, byColor), { skipValidation: true });
  const out = [];
  for (const mv of board.moves({ verbose: true })) {
    if (mv.to === square) out.push({ square: mv.from, type: mv.piece, color: mv.color });
  }
  return out;
}

export function sideToMoveFen(fen, color) {
  const parts = fen.split(' ');
  parts[1] = color;
  parts[3] = '-';
  return parts.join(' ');
}

/**
 * Static Exchange Evaluation on `square` for the side `color` initiating the
 * capture sequence with `attackerSquare`.
 *
 * Returns the material the initiating side wins (positive) or loses (negative)
 * assuming both sides always recapture with their least valuable attacker and
 * may stop at any point.
 *
 * Implemented on a lightweight 0x88-style board so that x-ray recaptures
 * (batteries, discovered defenders) are handled correctly.
 */
export function see(fen, from, to) {
  const b = new SimpleBoard(fen);
  return b.see(from, to);
}

/** Best (max) SEE gain available to `color` over all its captures in `fen`. */
export function bestCaptureSee(fen, color) {
  const board = new Chess();
  board.load(sideToMoveFen(fen, color), { skipValidation: true });
  let best = { gain: 0, from: null, to: null };
  for (const mv of board.moves({ verbose: true })) {
    if (!mv.captured && mv.flags.indexOf('e') === -1) continue;
    const gain = see(sideToMoveFen(fen, color), mv.from, mv.to);
    if (gain > best.gain) best = { gain, from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured };
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Minimal board used for SEE (0x88 board, handles sliding x-rays)
 * ------------------------------------------------------------------ */

const KNIGHT_DELTAS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_DELTAS = [1, -1, 16, -16, 17, -17, 15, -15];
const BISHOP_DELTAS = [17, -17, 15, -15];
const ROOK_DELTAS = [1, -1, 16, -16];

export class SimpleBoard {
  constructor(fen) {
    this.board = new Array(128).fill(null);
    const [placement, turn] = fen.split(' ');
    let idx = 112; // a8
    for (const ch of placement) {
      if (ch === '/') {
        idx -= 24;
      } else if (ch >= '1' && ch <= '8') {
        idx += Number(ch);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        this.board[idx] = { type: ch.toLowerCase(), color };
        idx += 1;
      }
    }
    this.turn = turn;
  }

  static sq0x88(square) {
    return FILES.indexOf(square[0]) + 16 * (Number(square[1]) - 1);
  }

  get(square) {
    return this.board[SimpleBoard.sq0x88(square)];
  }

  /** Squares of all pieces of `color` attacking 0x88 square `target`. */
  attackers(target, color) {
    const out = [];
    // pawns
    const pawnDir = color === 'w' ? -16 : 16; // from target back to the pawn
    for (const d of [pawnDir + 1, pawnDir - 1]) {
      const s = target + d;
      if (s & 0x88) continue;
      const p = this.board[s];
      if (p && p.color === color && p.type === 'p') out.push(s);
    }
    // knights
    for (const d of KNIGHT_DELTAS) {
      const s = target + d;
      if (s & 0x88) continue;
      const p = this.board[s];
      if (p && p.color === color && p.type === 'n') out.push(s);
    }
    // king
    for (const d of KING_DELTAS) {
      const s = target + d;
      if (s & 0x88) continue;
      const p = this.board[s];
      if (p && p.color === color && p.type === 'k') out.push(s);
    }
    // sliders
    for (const d of BISHOP_DELTAS) {
      let s = target + d;
      while (!(s & 0x88)) {
        const p = this.board[s];
        if (p) {
          if (p.color === color && (p.type === 'b' || p.type === 'q')) out.push(s);
          break;
        }
        s += d;
      }
    }
    for (const d of ROOK_DELTAS) {
      let s = target + d;
      while (!(s & 0x88)) {
        const p = this.board[s];
        if (p) {
          if (p.color === color && (p.type === 'r' || p.type === 'q')) out.push(s);
          break;
        }
        s += d;
      }
    }
    return out;
  }

  /**
   * SEE for capturing on `to` starting with the piece on `from`.
   *
   * Plain negamax-with-stand-pat over the capture sequence: each side may stop
   * recapturing at any point, and always uses its least valuable attacker.
   * X-rays fall out naturally because attackers are recomputed on the mutated
   * board after every capture.
   */
  see(from, to) {
    const fromIdx = SimpleBoard.sq0x88(from);
    const toIdx = SimpleBoard.sq0x88(to);
    const attacker = this.board[fromIdx];
    if (!attacker) return 0;
    const target = this.board[toIdx];
    const victimValue = target ? SAC_VALUE[target.type] : 0;

    const occupied = this.board.slice();
    occupied[toIdx] = attacker;
    occupied[fromIdx] = null;
    const other = attacker.color === 'w' ? 'b' : 'w';
    return victimValue - this._seeRec(occupied, toIdx, other, 0);
  }

  /** Best material the side to move can still win on `toIdx` (>= 0). */
  _seeRec(occupied, toIdx, color, depth) {
    if (depth > 32) return 0;
    const atk = this._leastValuableAttacker(occupied, toIdx, color);
    if (atk === null) return 0;
    const victim = occupied[toIdx];
    const victimValue = victim ? SAC_VALUE[victim.type] : 0;
    const next = occupied.slice();
    next[toIdx] = next[atk];
    next[atk] = null;
    const other = color === 'w' ? 'b' : 'w';
    return Math.max(0, victimValue - this._seeRec(next, toIdx, other, depth + 1));
  }

  _leastValuableAttacker(occupied, target, color) {
    const saved = this.board;
    this.board = occupied;
    const atks = this.attackers(target, color);
    this.board = saved;
    if (atks.length === 0) return null;
    let best = null;
    let bestVal = Infinity;
    for (const s of atks) {
      const v = SAC_VALUE[occupied[s].type];
      if (v < bestVal) {
        bestVal = v;
        best = s;
      }
    }
    return best;
  }
}
