import { cpToWinProb } from '../engine/uci.js';

/**
 * Brilliant (!!) classifier.
 *
 * Chess.com describes a Brilliant move as *a good sacrifice that is not
 * obvious*. That is expressed here as explicit, inspectable gates:
 *
 *   G1 sacrifice   material is handed over that the opponent can win by force
 *   G2 quality     the move is still a good move in expected-points terms
 *   G3 soundness   the player is not worse off after it
 *   G4 necessity   the player was not already completely winning without it
 *   G5 exclusions  forced/only moves, positions already in check, …
 *   G6 non-obvious a shallow (weak) search does not already pick the move –
 *                  the signal Zaidi & Guerzhoy (2024) found most predictive
 *
 * Every threshold is a parameter so the rules can be tuned *and* audited.
 */

export const DEFAULT_PARAMS = {
  // G1 – sacrifice. Chess.com reasons about the gross value of the piece left
  // en prise; `sacNet` only weeds out pure equal trades.
  minSacGross: 300,
  minSacNet: 100,

  // G2 – move quality, in expected points (Chess.com's own currency).
  // A Brilliant must still be a *good* move, not necessarily the best one.
  maxEpLoss: 0.09,
  maxCpLossAbsolute: 400,

  // G3 – soundness after the move. Chess.com: "the evaluation must remain
  // favourable". A small negative tolerance absorbs Lite's evaluation noise.
  minPlayedCp: -40,

  // G4 – the sacrifice has to be worth something: if a quiet alternative was
  // already completely winning, Chess.com does not award Brilliant.
  maxSecondCp: 700,
  secondRuleOnlyWhenBestIsCp: true,
  excludeBothMate: false,

  // G5 – structural exclusions. Both mirror Chess.com replica behaviour and
  // pay for themselves: together they cost 1 of the 100 benchmark labels and
  // remove ~15 % of the detections.
  excludePromotion: true,
  excludeInCheck: true,
  excludeForced: true,
  excludeRecapture: false,
  excludeKingMove: false,
  maxRank: 0, // 0 = off; otherwise the move must be in the engine's top N
  // The move must *create* the offer: material that was already hanging before
  // the move is a loose piece being ignored, not a sacrifice.
  requireNewSacrifice: false,

  // G6 – non-obviousness.
  requireShallowDisagreement: false,
  minShallowRank: 1,

  // G7 – the offer has to be real: how much material the mover is actually
  // down at the worst point of the engine's main line. 0 disables the gate
  // (a sacrifice the opponent must *decline* never shows up in the PV).
  minPvSacrifice: 0,
};

export const GATES = [
  ['no-piece-sacrifice', (f, p) => f.sacGross < p.minSacGross],
  ['sacrifice-too-small', (f, p) => f.sacNet < p.minSacNet],
  ['promotion', (f, p) => p.excludePromotion && f.isPromotion],
  ['was-in-check', (f, p) => p.excludeInCheck && f.inCheckBefore],
  ['forced', (f, p) => p.excludeForced && f.nLegalBefore <= 1],
  ['recapture', (f, p) => p.excludeRecapture && f.isRecapture],
  ['king-move', (f, p) => p.excludeKingMove && f.movedPiece === 'k'],
  [
    'already-hanging',
    (f, p) => p.requireNewSacrifice && (f.preSacGross ?? 0) >= f.sacGross,
  ],
  ['rank-too-low', (f, p) => p.maxRank > 0 && (f.playedRank === 0 || f.playedRank > p.maxRank)],
  [
    'not-really-sacrificed',
    (f, p) =>
      p.minPvSacrifice > 0 &&
      f.pvMaterialMin !== undefined &&
      f.materialBalanceBefore - f.pvMaterialMin < p.minPvSacrifice,
  ],
  ['no-eval', (f) => f.playedCp === null || f.playedCp === undefined],
  [
    'not-good-enough',
    (f, p) =>
      !f.isBestMove &&
      f.playedCp !== null &&
      ((f.epLoss ?? 0) > p.maxEpLoss || (f.evalLoss ?? 0) > p.maxCpLossAbsolute),
  ],
  ['losing-after', (f, p) => f.playedCp !== null && f.playedCp < p.minPlayedCp],
  [
    'winning-anyway',
    (f, p) =>
      f.secondCp !== null &&
      f.secondCp !== undefined &&
      f.secondCp >= p.maxSecondCp &&
      !f.mateSecond &&
      (!p.secondRuleOnlyWhenBestIsCp || !f.mateBefore),
  ],
  ['mate-anyway', (f, p) => p.excludeBothMate && f.mateBefore && f.mateSecond],
  [
    'obvious-to-weak-engine',
    (f, p) =>
      p.requireShallowDisagreement && f.shallowRank !== null && f.shallowRank <= p.minShallowRank,
  ],
];

/**
 * Named operating points along the recall / selectivity frontier.
 * Numbers are from `bench/report.js`; see RESULTS.md.
 */
export const PRESETS = {
  /** Highest recall. Also accepts sacrifices in already-winning positions. */
  recall: { maxSecondCp: 1200, excludePromotion: false, minPlayedCp: -80 },
  /** Default. Best recall per detection on the benchmark. */
  balanced: {},
  /**
   * Recommended for a user-facing product: `balanced` plus the king-move
   * exclusion. A king step that happens to leave a piece en prise is never what
   * Chess.com badges; on the benchmark this costs 2 of 96 labels and removes 9
   * detections, and on the one game with verified Chess.com labels it removes a
   * false positive at no cost. Pair it with `settings.dedupeSacrifices = true`.
   */
  production: { excludeKingMove: true },
  /** Fewer, more clear-cut brilliancies. */
  strict: { maxSecondCp: 550, minPlayedCp: 0, excludeKingMove: true },
  /** Only the engine's top move counts, like the freechess replica. */
  'top-move-only': {
    maxRank: 1,
    maxEpLoss: 0,
    minPlayedCp: 0,
    maxSecondCp: 700,
    excludeBothMate: true,
    excludeKingMove: true,
  },
};

export function classifyBrilliant(f, params) {
  const p = { ...DEFAULT_PARAMS, ...(params || {}) };
  for (const [name, test] of GATES) {
    if (test(f, p)) return { brilliant: false, reason: name, score: 0 };
  }
  return { brilliant: true, reason: null, score: brillianceScore(f) };
}

/**
 * Soft confidence in [0,1] – used for ranking and for the UI, not for the
 * binary decision.
 */
export function brillianceScore(f) {
  if (f.playedCp === null || f.playedCp === undefined) return 0;
  const sacTerm = Math.min(1, (f.sacGross || 0) / 900);
  const qualityTerm = 1 - Math.min(1, Math.max(0, f.epLoss ?? 0) / 0.09);
  const needTerm = 1 - Math.min(1, Math.max(0, f.secondCp ?? 0) / 700);
  const surpriseTerm = f.shallowRank ? Math.min(1, (f.shallowRank - 1) / 4) : 0.5;
  return Number((0.3 * sacTerm + 0.3 * qualityTerm + 0.25 * needTerm + 0.15 * surpriseTerm).toFixed(3));
}
