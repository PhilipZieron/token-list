import { Chess } from 'chess.js';
import { cpToWinProb, isMateScore, MATE_SCORE } from '../engine/uci.js';
import { materialFeatures } from './features.js';
import { see, sideToMoveFen, SAC_VALUE } from './board.js';

/**
 * Combines the engine output for one move into the feature vector the
 * classifier consumes. Everything is expressed from the *mover's* point of
 * view (positive = good for the player who made the move).
 *
 * @param {object} p
 * @param {string} p.fenBefore
 * @param {string} p.fenAfter
 * @param {object} p.move          chess.js verbose move
 * @param {Array}  p.deepLines     MultiPV lines for fenBefore (mover-relative)
 * @param {Array}  p.afterLines    MultiPV lines for fenAfter  (opponent-relative)
 * @param {Array} [p.shallowLines] weak/low-depth MultiPV lines for fenBefore
 */
export function buildMoveFeatures({
  fenBefore,
  fenAfter,
  move,
  deepLines,
  afterLines,
  shallowLines,
  prevMove = null,
}) {
  const uci = move.from + move.to + (move.promotion || '');
  const mf = materialFeatures(fenBefore, fenAfter, move);

  const best = deepLines?.[0];
  const second = deepLines?.[1];
  const third = deepLines?.[2];

  const bestCp = best ? best.cp : 0;
  const secondCp = second ? second.cp : null;

  // Evaluation of the move actually played, mover-relative.
  const matching = deepLines?.find((l) => l.move === uci);
  const afterTop = afterLines?.[0];
  const playedCpFromAfter = afterTop ? -afterTop.cp : null;
  const playedCp = matching ? matching.cp : playedCpFromAfter;

  const isBestMove = best?.move === uci;
  const playedRank = deepLines ? deepLines.findIndex((l) => l.move === uci) + 1 : 0;

  const evalLoss = playedCp === null ? null : bestCp - playedCp;
  const epBefore = cpToWinProb(bestCp);
  const epAfter = playedCp === null ? null : cpToWinProb(playedCp);
  const epLoss = epAfter === null ? null : epBefore - epAfter;
  const epSecond = secondCp === null ? null : cpToWinProb(secondCp);

  // --- "weak engine disagrees with strong engine" (Zaidi & Guerzhoy 2024) ---
  let shallowRank = null;
  let shallowLoss = null;
  let shallowBestCp = null;
  if (shallowLines && shallowLines.length) {
    shallowBestCp = shallowLines[0].cp;
    const idx = shallowLines.findIndex((l) => l.move === uci);
    shallowRank = idx === -1 ? shallowLines.length + 1 : idx + 1;
    shallowLoss = idx === -1 ? null : shallowLines[0].cp - shallowLines[idx].cp;
  }

  // --- what happens if the opponent accepts the sacrifice? ---
  const board = new Chess();
  board.load(fenAfter, { skipValidation: true });
  const opp = move.color === 'w' ? 'b' : 'w';
  const oppTop = afterLines?.[0]?.move || null;
  const acceptance = classifyAcceptance(fenAfter, opp, oppTop, mf);

  const chessBefore = new Chess();
  chessBefore.load(fenBefore, { skipValidation: true });
  const chessAfter = board;

  return {
    uci,
    san: move.san,
    color: move.color,
    // material
    ...mf,
    // engine
    bestCp,
    secondCp,
    thirdCp: third ? third.cp : null,
    playedCp,
    playedRank,
    isBestMove,
    evalLoss,
    epBefore,
    epAfter,
    epLoss,
    epSecond,
    epGainOverSecond: epSecond === null || epAfter === null ? null : epAfter - epSecond,
    cpGainOverSecond: secondCp === null || playedCp === null ? null : playedCp - secondCp,
    mateBefore: isMateScore(bestCp),
    mateAfter: playedCp !== null && isMateScore(playedCp),
    mateSecond: secondCp !== null && isMateScore(secondCp),
    // weak-engine disagreement
    shallowRank,
    shallowLoss,
    shallowBestCp,
    shallowDisagreement:
      shallowBestCp === null || playedCp === null ? null : shallowRank > 1 ? 1 : 0,
    // position/tactical context
    givesCheck: chessAfter.isCheck(),
    inCheckBefore: chessBefore.isCheck(),
    nLegalBefore: chessBefore.moves().length,
    // A recapture on the square the opponent just captured on is never a
    // "sacrifice" in Chess.com's sense, it is just restoring material.
    isRecapture: Boolean(prevMove && prevMove.captured && prevMove.to === move.to),
    oppBestReply: oppTop,
    acceptsSac: acceptance.accepts,
    pieceCount: countPieces(chessAfter),
    materialBalanceBefore: materialBalanceOf(chessBefore, move.color),
    // How much of the offered material comes straight back in the engine's
    // main line – a "sacrifice" that is recovered at once is usually just a
    // tactic, not a sacrifice.
    ...pvMaterialProfile(fenAfter, afterLines?.[0]?.pv || [], move.color),
  };
}

function materialBalanceOf(chess, color) {
  let t = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.type === 'k') continue;
      t += (p.color === color ? 1 : -1) * SAC_VALUE[p.type];
    }
  }
  return t;
}

/** Does the engine's top reply actually take the offered material? */
function classifyAcceptance(fenAfter, oppColor, oppTopUci, mf) {
  if (!oppTopUci || !mf.hangingSquare) return { accepts: null };
  return { accepts: oppTopUci.slice(2, 4) === mf.hangingSquare };
}

function countPieces(chess) {
  let n = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k' && p.type !== 'p') n++;
  return n;
}

/**
 * Walks the engine's principal variation from the position after the move and
 * records how the mover's material balance develops.
 *   pvMaterialMin  – worst material balance reached (mover-relative)
 *   pvMaterialEnd  – balance at the end of the walked PV
 */
function pvMaterialProfile(fenAfter, pv, moverColor, maxPlies = 8) {
  const c = new Chess();
  c.load(fenAfter, { skipValidation: true });
  let min = materialBalanceOf(c, moverColor);
  let end = min;
  for (let i = 0; i < Math.min(pv.length, maxPlies); i++) {
    const m = pv[i];
    try {
      c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
    } catch {
      break;
    }
    end = materialBalanceOf(c, moverColor);
    if (end < min) min = end;
  }
  return { pvMaterialMin: min, pvMaterialEnd: end };
}
