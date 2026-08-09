/**
 * Type declarations for chess-brilliance.
 * Hand-written: the source is plain ESM JavaScript.
 */

export type Colour = 'w' | 'b';
export type PresetName = 'recall' | 'balanced' | 'production' | 'strict' | 'top-move-only';

/** Why a sacrifice candidate was rejected. `null` on an accepted move. */
export type RejectReason =
  | 'no-piece-sacrifice'
  | 'sacrifice-too-small'
  | 'promotion'
  | 'was-in-check'
  | 'forced'
  | 'recapture'
  | 'king-move'
  | 'already-hanging'
  | 'rank-too-low'
  | 'not-really-sacrificed'
  | 'no-eval'
  | 'not-good-enough'
  | 'losing-after'
  | 'winning-anyway'
  | 'mate-anyway'
  | 'obvious-to-weak-engine';

export interface ClassifierParams {
  /** Minimum gross value of the piece offered, centipawns. Default 300. */
  minSacGross: number;
  /** Minimum net material handed over, centipawns. Default 100. */
  minSacNet: number;
  /** Maximum expected-points loss, 0..1. Default 0.09. */
  maxEpLoss: number;
  maxCpLossAbsolute: number;
  /** Evaluation after the move must be at least this, centipawns. Default -40. */
  minPlayedCp: number;
  /** If the second-best move already wins by this much, no badge. Default 700. */
  maxSecondCp: number;
  secondRuleOnlyWhenBestIsCp: boolean;
  excludeBothMate: boolean;
  excludePromotion: boolean;
  excludeInCheck: boolean;
  excludeForced: boolean;
  excludeRecapture: boolean;
  excludeKingMove: boolean;
  /** 0 = off, otherwise the move must be in the engine's top N. */
  maxRank: number;
  requireNewSacrifice: boolean;
  requireShallowDisagreement: boolean;
  minShallowRank: number;
  minPvSacrifice: number;
}

export interface AnalysisSettings {
  deepDepth: number;
  deepMultiPv: number;
  afterDepth: number;
  afterMultiPv: number;
  shallowDepth: number;
  shallowMultiPv: number;
  useShallow: boolean;
  prefilter: { minSacNet: number; minSacGross: number };
  /** Collapse a standing sacrifice reported on consecutive plies into one. */
  dedupeSacrifices: boolean;
}

/** Everything the classifier saw. Useful for UI copy and for debugging. */
export interface MoveFeatures {
  uci: string;
  san: string;
  color: Colour;
  /** Gross value of the piece offered, centipawns (300 = a minor piece). */
  sacGross: number;
  /** Net material handed over after counting what the move captured. */
  sacNet: number;
  seeOfMove: number;
  capturedValue: number;
  hangingGain: number;
  hangingSquare: string | null;
  movedPiece: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  isCapture: boolean;
  isPromotion: boolean;
  isRecapture: boolean;
  /** Engine evaluation, mover-relative centipawns. */
  bestCp: number;
  secondCp: number | null;
  playedCp: number | null;
  /** 1-based rank of the played move in the engine's MultiPV list; 0 = outside. */
  playedRank: number;
  isBestMove: boolean;
  evalLoss: number | null;
  /** Expected-points loss, 0..1 — Chess.com's own currency. */
  epLoss: number | null;
  mateBefore: boolean;
  mateAfter: boolean;
  mateSecond: boolean;
  givesCheck: boolean;
  inCheckBefore: boolean;
  nLegalBefore: number;
  pieceCount: number;
  shallowRank: number | null;
  [key: string]: unknown;
}

export interface AnalysedMove {
  /** 1-based half-move number (ply 1 = White's first move). */
  ply: number;
  /** Full move number, i.e. `Math.ceil(ply / 2)`. */
  moveNumber: number;
  color: Colour;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  brilliant: boolean;
  reason: RejectReason | null;
  /** Soft confidence 0..1 — for ranking and UI, not for the decision. */
  score: number;
  features: MoveFeatures;
}

export interface Report {
  headers: Record<string, string>;
  nPlies: number;
  /** Positions the engine actually looked at. */
  nCandidates: number;
  brilliants: AnalysedMove[];
  /** Every sacrifice candidate, accepted or not, with its rejection reason. */
  candidates: AnalysedMove[];
}

export interface Progress {
  done: number;
  total: number;
  ply: number;
}

export interface AnalyseOptions {
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  params?: PresetName | Partial<ClassifierParams>;
  settings?: Partial<AnalysisSettings>;
}

export declare class AnalysisCancelled extends Error {
  name: 'AnalysisCancelled';
}

export interface EngineAdapter {
  analyse(fen: string, opts: { depth: number; multiPv: number }): Promise<unknown[]>;
  quit?(): void | Promise<void>;
}

export declare class BrilliantAnalyser {
  constructor(options: {
    createEngine: () => Promise<EngineAdapter> | EngineAdapter;
    params?: PresetName | Partial<ClassifierParams>;
    settings?: Partial<AnalysisSettings>;
  });
  params: ClassifierParams;
  settings: AnalysisSettings;
  /** Loads the engine. Idempotent — call early to warm the download. */
  ready(): Promise<EngineAdapter>;
  /** Engine cost of a PGN without touching the engine. */
  estimate(pgn: string): { plies: number; candidates: number; searches: number };
  analyse(pgn: string, opts?: AnalyseOptions): Promise<Report>;
  /** Waits for queued work, then frees the engine. Rejects later calls. */
  dispose(): Promise<void>;
}

export declare function createBrilliantAnalyser(options: {
  /** URL of `stockfish-17.1-lite-single-*.js`; the `.wasm` must sit beside it. */
  enginePath: string;
  hashMb?: number;
  params?: PresetName | Partial<ClassifierParams>;
  settings?: Partial<AnalysisSettings>;
}): BrilliantAnalyser;

export declare const PRESETS: Record<PresetName, Partial<ClassifierParams>>;
export declare const DEFAULT_PARAMS: ClassifierParams;
export declare const DEFAULT_SETTINGS: AnalysisSettings;

export declare function analyseGame(
  pgn: string,
  engine: EngineAdapter,
  options?: AnalyseOptions
): Promise<Report>;

export declare function countCandidates(
  pgn: string,
  prefilter?: AnalysisSettings['prefilter']
): { plies: number; candidates: number };

export declare function classifyBrilliant(
  features: MoveFeatures,
  params?: Partial<ClassifierParams>
): { brilliant: boolean; reason: RejectReason | null; score: number };

export declare function parsePgn(pgn: string): {
  headers: Record<string, string>;
  moves: string[];
};

export declare function replay(pgn: string): {
  headers: Record<string, string>;
  plies: Array<{
    ply: number;
    san: string;
    uci: string;
    color: Colour;
    fenBefore: string;
    fenAfter: string;
  }>;
};
