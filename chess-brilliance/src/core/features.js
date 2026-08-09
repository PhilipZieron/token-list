import { Chess } from 'chess.js';
import { see, sideToMoveFen, SAC_VALUE } from './board.js';

/**
 * Static (engine-free) features describing the *material* consequences of a
 * move. These drive the cheap pre-filter: a move can only be Brilliant if the
 * player gives material away, so positions that pass this filter are the only
 * ones that need deep engine analysis.
 */

/** Best static-exchange gain available to `color` in `fen`, per target square. */
export function opponentCaptureGains(fen, color) {
  const board = new Chess();
  board.load(sideToMoveFen(fen, color), { skipValidation: true });
  const forced = sideToMoveFen(fen, color);
  const gains = [];
  for (const mv of board.moves({ verbose: true })) {
    const isCapture = Boolean(mv.captured) || mv.flags.includes('e');
    if (!isCapture) continue;
    const gain = see(forced, mv.from, mv.to);
    gains.push({ from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured, gain });
  }
  gains.sort((a, b) => b.gain - a.gain);
  return gains;
}

/**
 * Material features for `move` played in `fenBefore` leading to `fenAfter`.
 *
 *  seeOfMove     – static exchange value of the played move itself
 *                  (negative => the moved piece can be won on its new square)
 *  hangingGain   – biggest material the opponent can now win by force (SEE)
 *  hangingSquare – where that happens
 *  sacGross      – value of the material offered ("you sacrificed a rook")
 *  sacNet        – net material given up after counting what the move captured
 */
export function materialFeatures(fenBefore, fenAfter, move) {
  const mover = move.color;
  const opp = mover === 'w' ? 'b' : 'w';

  const seeOfMove = see(sideToMoveFen(fenBefore, mover), move.from, move.to);
  const capturedValue = move.captured ? SAC_VALUE[move.captured] : 0;

  const gains = opponentCaptureGains(fenAfter, opp);
  const best = gains[0] || { gain: 0, to: null };
  const hangingGain = Math.max(0, best.gain);

  // Value of the biggest piece the opponent can profitably win.
  const boardAfter = new Chess();
  boardAfter.load(fenAfter, { skipValidation: true });
  let sacGross = 0;
  for (const g of gains) {
    if (g.gain <= 0) continue;
    const victim = boardAfter.get(g.to);
    const v = victim ? SAC_VALUE[victim.type] : 0;
    if (v > sacGross) sacGross = v;
  }
  if (seeOfMove < 0) {
    const movedPieceValue = SAC_VALUE[move.piece];
    sacGross = Math.max(sacGross, movedPieceValue);
  }

  const sacNet = Math.max(-seeOfMove, hangingGain - capturedValue, 0);

  return {
    seeOfMove,
    capturedValue,
    hangingGain,
    hangingSquare: best.to,
    sacGross,
    sacNet,
    isCapture: Boolean(move.captured),
    isPromotion: Boolean(move.promotion),
    movedPiece: move.piece,
    movedPieceValue: SAC_VALUE[move.piece],
  };
}

/**
 * Cheap candidate filter. Returns true when the move gives up material and is
 * therefore worth spending engine time on.
 *
 * `minSacNet` / `minSacGross` are intentionally generous – precision comes
 * later from the engine stage.
 */
export function isSacrificeCandidate(mf, { minSacNet = 90, minSacGross = 100 } = {}) {
  if (mf.sacNet < minSacNet) return false;
  if (mf.sacGross < minSacGross) return false;
  return true;
}

/** True when the position after the move is check (opponent is in check). */
export function givesCheck(fenAfter) {
  const c = new Chess();
  c.load(fenAfter, { skipValidation: true });
  return c.isCheck();
}

export function legalMoveCount(fen) {
  const c = new Chess();
  c.load(fen, { skipValidation: true });
  return c.moves().length;
}
