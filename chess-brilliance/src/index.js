/**
 * Public API: analyse a whole game and return its Brilliant moves.
 *
 * Engine-agnostic – pass any object with
 *   `analyse(fen, { depth, multiPv }) -> Promise<lines>`
 * so the same code drives the Node worker pool and the browser Web Worker.
 */
import { Chess } from 'chess.js';
import { replay } from './core/pgn.js';
import { materialFeatures, isSacrificeCandidate } from './core/features.js';
import { buildMoveFeatures } from './core/analysis.js';
import { classifyBrilliant, DEFAULT_PARAMS } from './core/classify.js';

export { classifyBrilliant, DEFAULT_PARAMS, PRESETS, GATES } from './core/classify.js';
export { replay, parsePgn } from './core/pgn.js';
export { materialFeatures, isSacrificeCandidate } from './core/features.js';

export const DEFAULT_SETTINGS = {
  deepDepth: 20,
  deepMultiPv: 5,
  afterDepth: 19,
  afterMultiPv: 2,
  shallowDepth: 8,
  shallowMultiPv: 5,
  useShallow: false,
  prefilter: { minSacNet: 100, minSacGross: 250 },
  /**
   * A sacrifice that the opponent declines stays en prise, so every following
   * ply looks like a fresh sacrifice of the same piece. With this on, only the
   * move that *creates* an offer is reported; later plies where the same piece
   * is still hanging on the same square are collapsed into it.
   *
   * Off by default because it is a judgement call, not a Chess.com rule:
   * on the benchmark it removes 20 of 185 detections and costs 2 of 96 labels.
   */
  dedupeSacrifices: false,
};

/**
 * @param {string} pgn
 * @param {{analyse: (fen: string, opts: object) => Promise<Array>}} engine
 * @param {object} [options]
 * @param {(p: {done:number,total:number,ply:number}) => void} [options.onProgress]
 */
export async function analyseGame(pgn, engine, options = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(options.settings || {}) };
  const params = { ...DEFAULT_PARAMS, ...(options.params || {}) };
  const { headers, plies } = replay(pgn);

  // --- stage 1: engine-free pre-filter -----------------------------------
  const candidates = [];
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i];
    const mf = materialFeatures(p.fenBefore, p.fenAfter, p.move);
    if (!isSacrificeCandidate(mf, settings.prefilter)) continue;
    candidates.push({ index: i, ...p, mf, prevMove: i > 0 ? plies[i - 1].move : null });
  }

  // --- stage 2: engine verification of the candidates only ---------------
  const results = [];
  let done = 0;
  for (const c of candidates) {
    const deepLines = await engine.analyse(c.fenBefore, {
      depth: settings.deepDepth,
      multiPv: settings.deepMultiPv,
    });
    const afterLines = await engine.analyse(c.fenAfter, {
      depth: settings.afterDepth,
      multiPv: settings.afterMultiPv,
    });
    const shallowLines = settings.useShallow
      ? await engine.analyse(c.fenBefore, {
          depth: settings.shallowDepth,
          multiPv: settings.shallowMultiPv,
        })
      : null;

    const f = buildMoveFeatures({
      fenBefore: c.fenBefore,
      fenAfter: c.fenAfter,
      move: c.move,
      deepLines,
      afterLines,
      shallowLines,
      prevMove: c.prevMove,
    });
    const verdict = classifyBrilliant(f, params);
    results.push({
      ply: c.ply,
      moveNumber: Math.ceil(c.ply / 2),
      color: c.color,
      san: c.san,
      uci: c.uci,
      fenBefore: c.fenBefore,
      fenAfter: c.fenAfter,
      brilliant: verdict.brilliant,
      reason: verdict.reason,
      score: verdict.score,
      features: f,
    });
    done++;
    options.onProgress?.({ done, total: candidates.length, ply: c.ply });
  }

  let brilliants = results.filter((r) => r.brilliant);
  if (settings.dedupeSacrifices) brilliants = dedupeRepeatedOffers(brilliants);

  return {
    headers,
    nPlies: plies.length,
    nCandidates: candidates.length,
    brilliants,
    candidates: results,
  };
}

/**
 * Collapses repeated reports of one standing sacrifice: the same player, the
 * same piece value, still hanging on the same square. The earliest ply wins,
 * because that is the move that actually created the offer.
 */
export function dedupeRepeatedOffers(brilliants) {
  const seen = new Set();
  const out = [];
  for (const b of [...brilliants].sort((a, b2) => a.ply - b2.ply)) {
    const key = `${b.color}|${b.features.hangingSquare}|${b.features.sacGross}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/** Convenience: how many positions the engine will actually have to look at. */
export function countCandidates(pgn, prefilter = DEFAULT_SETTINGS.prefilter) {
  const { plies } = replay(pgn);
  let n = 0;
  for (const p of plies) {
    if (isSacrificeCandidate(materialFeatures(p.fenBefore, p.fenAfter, p.move), prefilter)) n++;
  }
  return { plies: plies.length, candidates: n };
}
