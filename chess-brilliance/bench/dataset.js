/**
 * Turns a set of games into the ply records the pipeline works on, and
 * selects the sacrifice candidates that deserve engine time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { replay } from '../src/core/pgn.js';
import {
  materialFeatures,
  isSacrificeCandidate,
  givesCheck,
  legalMoveCount,
} from '../src/core/features.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '../data');

/**
 * Generous engine-free gate: everything that gives material away.
 * Chess.com reasons about the *gross* value of the piece left en prise
 * ("you sacrificed a bishop"), so the gross threshold is the strict one and
 * the net threshold only removes pure equal trades.
 */
export const PREFILTER = { minSacNet: 100, minSacGross: 250 };

export function loadDataset(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

function isCheckFen(fen) {
  const c = new Chess();
  c.load(fen, { skipValidation: true });
  return c.isCheck();
}

/**
 * @param {Array<{pgn:string, ply?:number|number[], negativePly?:number[]}>} games
 */
export function buildRecords(games, { source = 'unknown' } = {}) {
  const outGames = [];
  const candidates = [];

  games.forEach((entry, gi) => {
    const { headers, plies } = replay(entry.pgn);
    const labels = new Set(
      Array.isArray(entry.ply) ? entry.ply : entry.ply === undefined ? [] : [entry.ply]
    );
    const negatives = new Set(entry.negativePly || []);

    const game = {
      id: entry.id || `${source}#${gi}`,
      source,
      white: headers.White,
      black: headers.Black,
      link: headers.Link || headers.Site,
      whiteElo: Number(headers.WhiteElo) || null,
      blackElo: Number(headers.BlackElo) || null,
      timeControl: headers.TimeControl || null,
      nPlies: plies.length,
      labels: [...labels],
      // `positives-only` means unlabelled plies are *assumed* negative.
      labelPolicy: entry.labelPolicy || (negatives.size ? 'explicit' : 'positives-only'),
    };
    outGames.push(game);

    for (let i = 0; i < plies.length; i++) {
      const p = plies[i];
      const prev = i > 0 ? plies[i - 1] : null;
      const mf = materialFeatures(p.fenBefore, p.fenAfter, p.move);
      const isLabel = labels.has(p.ply);
      const explicitNeg = negatives.has(p.ply);
      const cand = isSacrificeCandidate(mf, PREFILTER);
      if (!cand && !isLabel) continue; // engine never sees it -> predicted "not brilliant"
      candidates.push({
        gameId: game.id,
        source,
        ply: p.ply,
        san: p.san,
        uci: p.uci,
        color: p.color,
        fenBefore: p.fenBefore,
        fenAfter: p.fenAfter,
        label: isLabel ? 1 : explicitNeg ? 0 : -1, // -1 = assumed negative
        prefiltered: cand,
        mf,
        prevMove: prev ? { to: prev.move.to, captured: prev.move.captured || null } : null,
        givesCheck: givesCheck(p.fenAfter),
        inCheckBefore: isCheckFen(p.fenBefore),
        nLegalBefore: legalMoveCount(p.fenBefore),
        whiteElo: game.whiteElo,
        blackElo: game.blackElo,
        elo: p.color === 'w' ? game.whiteElo : game.blackElo,
      });
    }
  });

  return { games: outGames, candidates };
}

/** Total ply count across games (denominator for false-positive rates). */
export function totalPlies(games) {
  return games.reduce((a, g) => a + g.nPlies, 0);
}
