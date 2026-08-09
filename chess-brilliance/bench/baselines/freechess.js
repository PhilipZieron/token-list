/**
 * Faithful port of the Brilliant-move rule used by WintrCat's "freechess"
 * game-report project (https://github.com/WintrCat/freechess), the best known
 * open-source replication of Chess.com's classifier.
 *
 * Kept here as (a) a published baseline to compare against and (b) an
 * independent second opinion when judging whether one of our extra detections
 * is really a false positive or just a move the benchmark did not label.
 *
 * Only the Brilliant branch is ported; the surrounding centipawn tiers are
 * reduced to what that branch needs.
 */
import { Chess } from 'chess.js';

const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: Infinity, m: 0 };
const promotions = [undefined, 'b', 'n', 'r', 'q'];

function getBoardCoordinates(square) {
  return { x: 'abcdefgh'.indexOf(square[0]), y: parseInt(square[1], 10) - 1 };
}
function getSquare(c) {
  return 'abcdefgh'.charAt(c.x) + (c.y + 1);
}

export function getAttackers(fen, square) {
  const attackers = [];
  const board = new Chess();
  board.load(fen, { skipValidation: true });
  const piece = board.get(square);
  if (!piece) return attackers;

  board.load(
    fen.replace(/(?<= )(?:w|b)(?= )/g, piece.color === 'w' ? 'b' : 'w').replace(/ [a-h][1-8] /g, ' - '),
    { skipValidation: true }
  );

  for (const move of board.moves({ verbose: true })) {
    if (move.to === square) attackers.push({ square: move.from, color: move.color, type: move.piece });
  }

  let oppositeKing;
  const oppositeColour = piece.color === 'w' ? 'b' : 'w';
  const pc = getBoardCoordinates(square);
  for (let dx = -1; dx <= 1 && !oppositeKing; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const s = getSquare({
        x: Math.min(Math.max(pc.x + dx, 0), 7),
        y: Math.min(Math.max(pc.y + dy, 0), 7),
      });
      const op = board.get(s);
      if (op && op.color === oppositeColour && op.type === 'k') {
        oppositeKing = { color: op.color, square: s, type: op.type };
        break;
      }
    }
  }
  if (!oppositeKing) return attackers;

  let kingCaptureLegal = false;
  try {
    board.move({ from: oppositeKing.square, to: square });
    kingCaptureLegal = true;
  } catch {}
  if (attackers.length > 0 || kingCaptureLegal) attackers.push(oppositeKing);
  return attackers;
}

export function getDefenders(fen, square) {
  const board = new Chess();
  board.load(fen, { skipValidation: true });
  const piece = board.get(square);
  const testAttacker = getAttackers(fen, square)[0];

  if (testAttacker) {
    board.load(
      fen.replace(/(?<= )(?:w|b)(?= )/g, testAttacker.color).replace(/ [a-h][1-8] /g, ' - '),
      { skipValidation: true }
    );
    for (const promotion of promotions) {
      try {
        board.move({ from: testAttacker.square, to: square, promotion });
        return getAttackers(board.fen(), square);
      } catch {}
    }
  } else {
    board.load(fen.replace(/(?<= )(?:w|b)(?= )/g, piece.color).replace(/ [a-h][1-8] /g, ' - '), {
      skipValidation: true,
    });
    board.put({ color: piece.color === 'w' ? 'b' : 'w', type: 'q' }, square);
    return getAttackers(board.fen(), square);
  }
  return [];
}

export function isPieceHanging(lastFen, fen, square) {
  const lastBoard = new Chess();
  lastBoard.load(lastFen, { skipValidation: true });
  const board = new Chess();
  board.load(fen, { skipValidation: true });

  const lastPiece = lastBoard.get(square) || { type: 'm', color: 'x' };
  const piece = board.get(square);
  if (!piece) return false;

  const attackers = getAttackers(fen, square);
  const defenders = getDefenders(fen, square);

  if (pieceValues[lastPiece.type] >= pieceValues[piece.type] && lastPiece.color !== piece.color) {
    return false;
  }
  if (
    piece.type === 'r' &&
    pieceValues[lastPiece.type] === 3 &&
    attackers.every((a) => pieceValues[a.type] === 3) &&
    attackers.length === 1
  ) {
    return false;
  }
  if (attackers.some((a) => pieceValues[a.type] < pieceValues[piece.type])) return true;

  if (attackers.length > defenders.length) {
    let minAttackerValue = Infinity;
    for (const a of attackers) minAttackerValue = Math.min(pieceValues[a.type], minAttackerValue);
    if (
      pieceValues[piece.type] < minAttackerValue &&
      defenders.some((d) => pieceValues[d.type] < minAttackerValue)
    ) {
      return false;
    }
    if (defenders.some((d) => pieceValues[d.type] === 1)) return false;
    return true;
  }
  return false;
}

/**
 * @param {object} ctx
 *  fenBefore, fenAfter, uci, san, moveColour ('white'|'black')
 *  topLines  – MultiPV lines for fenBefore, **white-relative** cp/mate objects
 *  evaluation – evaluation of fenAfter, white-relative
 */
export function isBrilliantFreechess({ fenBefore, fenAfter, uci, san, moveColour, topLines, evaluation }) {
  const topMove = topLines[0];
  const secondTopMove = topLines[1];
  if (!topMove || !secondTopMove) return false;

  // freechess only ever considers a move that is the engine's top choice
  if (topMove.moveUCI !== uci) return false;

  const sign = moveColour === 'white' ? 1 : -1;
  const absoluteEvaluation = evaluation.value * sign;
  const absoluteSecondEvaluation = (secondTopMove.evaluation.value ?? 0) * sign;

  const winningAnyways =
    (absoluteSecondEvaluation >= 700 && topMove.evaluation.type === 'cp') ||
    (topMove.evaluation.type === 'mate' && secondTopMove.evaluation.type === 'mate');

  if (!(absoluteEvaluation >= 0 && !winningAnyways && !san.includes('='))) return false;

  const lastBoard = new Chess();
  lastBoard.load(fenBefore, { skipValidation: true });
  const currentBoard = new Chess();
  currentBoard.load(fenAfter, { skipValidation: true });
  if (lastBoard.isCheck()) return false;

  const lastPiece = lastBoard.get(uci.slice(2, 4)) || { type: 'm' };

  const sacrificedPieces = [];
  let brilliant = false;
  for (const row of currentBoard.board()) {
    for (const piece of row) {
      if (!piece) continue;
      if (piece.color !== moveColour.charAt(0)) continue;
      if (piece.type === 'k' || piece.type === 'p') continue;
      if (pieceValues[lastPiece.type] >= pieceValues[piece.type]) continue;
      if (isPieceHanging(fenBefore, fenAfter, piece.square)) {
        brilliant = true;
        sacrificedPieces.push(piece);
      }
    }
  }
  if (!brilliant) return false;

  let anyPieceViablyCapturable = false;
  const captureTestBoard = new Chess();
  captureTestBoard.load(fenAfter, { skipValidation: true });

  outer: for (const piece of sacrificedPieces) {
    for (const attacker of getAttackers(fenAfter, piece.square)) {
      for (const promotion of promotions) {
        try {
          captureTestBoard.move({ from: attacker.square, to: piece.square, promotion });
        } catch {
          continue;
        }
        let attackerPinned = false;
        for (const row of captureTestBoard.board()) {
          for (const enemyPiece of row) {
            if (!enemyPiece) continue;
            if (enemyPiece.color === captureTestBoard.turn()) continue;
            if (enemyPiece.type === 'k' || enemyPiece.type === 'p') continue;
            if (
              isPieceHanging(fenAfter, captureTestBoard.fen(), enemyPiece.square) &&
              pieceValues[enemyPiece.type] >= Math.max(...sacrificedPieces.map((s) => pieceValues[s.type]))
            ) {
              attackerPinned = true;
              break;
            }
          }
          if (attackerPinned) break;
        }

        if (pieceValues[piece.type] >= 5) {
          if (!attackerPinned) {
            anyPieceViablyCapturable = true;
            captureTestBoard.undo();
            break outer;
          }
        } else if (!attackerPinned && !captureTestBoard.moves().some((m) => m.endsWith('#'))) {
          anyPieceViablyCapturable = true;
          captureTestBoard.undo();
          break outer;
        }
        captureTestBoard.undo();
      }
    }
  }

  return anyPieceViablyCapturable;
}
