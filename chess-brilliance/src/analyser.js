/**
 * `BrilliantAnalyser` — the interface an application should use.
 *
 * `analyseGame()` is a pure function that takes an engine; this class owns the
 * things an app actually has to deal with:
 *
 *   * loading the 7 MB engine **once** and reusing it across games,
 *   * serialising requests so two analyses cannot interleave on one engine,
 *   * cancellation, because users navigate away mid-analysis,
 *   * progress reporting.
 *
 * It is deliberately environment-agnostic: hand it a factory that produces an
 * engine adapter. `createBrowserAnalyser()` in `browser.js` wires up the Web
 * Worker version; the Node adapter works the same way.
 */
import { analyseGame, countCandidates, DEFAULT_SETTINGS } from './index.js';
import { PRESETS, DEFAULT_PARAMS } from './core/classify.js';

export class AnalysisCancelled extends Error {
  constructor() {
    super('analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

export class BrilliantAnalyser {
  /**
   * @param {object} options
   * @param {() => Promise<{analyse: Function, quit?: Function}>} options.createEngine
   * @param {object|string} [options.params]   preset name or explicit params
   * @param {object} [options.settings]
   */
  constructor({ createEngine, params = 'production', settings = {} } = {}) {
    if (typeof createEngine !== 'function') {
      throw new TypeError('BrilliantAnalyser needs a createEngine() factory');
    }
    this._createEngine = createEngine;
    this._engine = null;
    this._loading = null;
    this._queue = Promise.resolve();
    this._disposed = false;
    this.params = resolveParams(params);
    this.settings = { ...DEFAULT_SETTINGS, dedupeSacrifices: true, ...settings };
  }

  /** Loads the engine (idempotent). Call it early to warm up the download. */
  async ready() {
    if (this._engine) return this._engine;
    if (!this._loading) {
      this._loading = Promise.resolve(this._createEngine()).then((e) => {
        this._engine = e;
        this._loading = null;
        return e;
      });
    }
    return this._loading;
  }

  /**
   * How much engine work a PGN implies, without touching the engine — useful
   * for showing a progress bar before the download has finished.
   */
  estimate(pgn) {
    const { plies, candidates } = countCandidates(pgn, this.settings.prefilter);
    return { plies, candidates, searches: candidates * (this.settings.useShallow ? 3 : 2) };
  }

  /**
   * @param {string} pgn
   * @param {object} [opts]
   * @param {(p:{done:number,total:number,ply:number}) => void} [opts.onProgress]
   * @param {AbortSignal} [opts.signal]
   * @param {object|string} [opts.params]    override the preset for this call
   * @param {object} [opts.settings]
   * @returns {Promise<import('./index.js').Report>}
   */
  analyse(pgn, opts = {}) {
    if (this._disposed) return Promise.reject(new Error('analyser has been disposed'));
    // Validate eagerly: a bad preset should throw at the call site, not turn
    // into a rejection several queued analyses later.
    const params = opts.params ? resolveParams(opts.params) : this.params;
    if (typeof pgn !== 'string' || !pgn.trim()) {
      throw new TypeError('analyse() needs a PGN string');
    }

    // One engine, one search at a time: queue rather than interleave.
    const run = this._queue.then(
      () => this._analyseNow(pgn, opts, params),
      () => this._analyseNow(pgn, opts, params)
    );
    this._queue = run.catch(() => {});
    return run;
  }

  async _analyseNow(pgn, opts, params) {
    const { signal } = opts;
    throwIfAborted(signal);
    const engine = await this.ready();
    throwIfAborted(signal);

    // Cancellation is cooperative: the engine finishes the search it is in and
    // then stops, which keeps the engine reusable afterwards.
    const guarded = {
      analyse: async (fen, o) => {
        throwIfAborted(signal);
        const lines = await engine.analyse(fen, o);
        throwIfAborted(signal);
        return lines;
      },
    };

    return analyseGame(pgn, guarded, {
      params,
      settings: { ...this.settings, ...(opts.settings || {}) },
      onProgress: opts.onProgress,
    });
  }

  /**
   * Releases the engine and its memory. Waits for queued work to finish first —
   * terminating a WASM engine mid-search crashes it. After `dispose()` the
   * analyser rejects further calls; construct a new one to start again.
   */
  async dispose() {
    this._disposed = true;
    try {
      await this._queue;
    } catch {}
    const e = this._engine;
    this._engine = null;
    this._loading = null;
    try {
      await e?.quit?.();
    } catch {}
  }
}

function resolveParams(p) {
  if (typeof p === 'string') {
    if (!(p in PRESETS)) {
      throw new Error(`unknown preset "${p}" – expected one of ${Object.keys(PRESETS).join(', ')}`);
    }
    return { ...DEFAULT_PARAMS, ...PRESETS[p] };
  }
  return { ...DEFAULT_PARAMS, ...(p || {}) };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AnalysisCancelled();
}
