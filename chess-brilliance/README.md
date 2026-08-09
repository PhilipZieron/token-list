# Brilliant Move Detector — Stockfish 17 Lite in the browser

Chess.com-style **Brilliant (!!)** move detection that runs entirely client-side on
**Stockfish 17.1 Lite** (single-threaded NNUE WASM, ~7 MB), scored against the
[Chessigma 100-move Brilliant benchmark](https://www.chessigma.com/benchmarks/brilliant).

| system | recall on the 100-move benchmark |
| --- | --- |
| **this project — default preset** | **96 / 100** |
| **this project — `recall` preset** | **98 / 100** |
| Chessigma (reference, self-reported) | 93 / 100 |
| [freechess](https://github.com/WintrCat/freechess) rule, re-implemented here on identical engine output | 44 / 100 |

Held-out check: tuning the thresholds on half the benchmark games and scoring the
other half gives **95/100**, so the numbers are not an artefact of fitting the
benchmark. Full detail, including detection rates on 600 unseen tournament games,
is in [`RESULTS.md`](RESULTS.md).

Everything — engine, pre-filter, classifier — runs in the browser with no server
and no cross-origin isolation (COOP/COEP) required: a 69-ply game is analysed in
about 5 seconds, because only the ~6 % of moves that give material away ever
reach the engine.

---

## How it works

```
PGN ──► replay ──► static material pre-filter ──► Stockfish 17.1 Lite ──► rule-based classifier ──► !!
                   (engine-free, ~6 % of plies)     (MultiPV, depth 20)      (auditable gates)
```

### 1. Static sacrifice pre-filter (no engine)

A move can only be Brilliant if the player gives material away, and that is
decidable statically. For each ply we compute, with a proper
[static exchange evaluation](src/core/board.js) (negamax-with-stand-pat over the
capture sequence, so x-rays and batteries are handled):

* `seeOfMove` — the exchange value of the played move itself
* `hangingGain` — the largest material the opponent can now win by force
* `sacGross` — the value of the piece offered ("you sacrificed a rook")
* `sacNet` — net material handed over after counting what the move captured

Only moves with `sacGross ≥ 250` and `sacNet ≥ 100` reach the engine.

On the benchmark that keeps **99 of the 100 labelled Brilliant moves while
discarding 93 % of all plies** — which is what makes full-game analysis
practical in a browser tab.

### 2. Engine stage

For each surviving candidate, Stockfish 17.1 Lite runs

* MultiPV 5 @ depth 20 on the position **before** the move → best move, second
  best, and the played move's own line
* MultiPV 2 @ depth 19 on the position **after** the move → evaluation of the
  move actually played
* (optional) MultiPV 5 @ depth 8 → the "weak engine" reference used for the
  non-obviousness signal

All evaluations are converted to the side-to-move's perspective and then into
**expected points** with the same logistic Chess.com uses:

```
win% = 100 / (1 + exp(-0.00368208 · centipawns))
```

### 3. Classifier — six auditable gates

Chess.com describes a Brilliant as *"a good sacrifice that is not obvious."*
That becomes explicit, tunable gates in [`src/core/classify.js`](src/core/classify.js):

| gate | rule | source |
| --- | --- | --- |
| **G1 sacrifice** | `sacGross ≥ 300` (minor piece or more) and `sacNet ≥ 100` | Chess.com: "a good piece sacrifice"; no pawn-only sacrifice appears among the 100 labelled moves |
| **G2 quality** | expected-points loss ≤ `maxEpLoss` | Chess.com's own expected-points model |
| **G3 soundness** | evaluation after the move ≥ `minPlayedCp` | "the evaluation must remain favourable" |
| **G4 necessity** | second-best move must not already be winning (`< 700 cp`) | Chess.com's "not winning anyway" rule; the 700 cp constant is the one used by freechess |
| **G5 exclusions** | forced/only moves, positions already in check, promotions, king moves | freechess / Chess.com replica behaviour |
| **G6 non-obvious** | a shallow search must not already pick the move | Zaidi & Guerzhoy, ICCC 2024 (**off by default — see findings**) |

**Only moves that were actually played are classified.** The pipeline replays the
PGN and asks, for each half-move in the game, "was *this* move a sound sacrifice?".
It never searches for a brilliant move that was merely *available*, and never
reports a move that was not played — the engine's own top moves are used only as
context. On the external corpus, 116 of 386 detections were not the engine's first
choice; they were reported because a human chose them.

**Multiple Brilliants per game are reported** — `analyseGame` returns a list and
nothing caps it at one. On the benchmark, 56 of 100 games get two or more
detections (the benchmark itself only labels one per game, which is why the extra
detections cannot be scored).

One caveat worth knowing: a sacrifice the opponent *declines* stays en prise, so
every following ply looks like a fresh offer of the same piece. One game in the
benchmark reports nine detections that are really one standing sacrifice. Set
`settings.dedupeSacrifices = true` to collapse those into the move that created
the offer (on the benchmark: 185 → 165 detections, 96 → 94 labels).

Five presets sit at different points of the recall/selectivity frontier —
`recall`, `balanced` (default), `production`, `strict`, `top-move-only`. For a
user-facing tool use `production` together with `dedupeSacrifices`:

```js
import { analyseGame, PRESETS } from './src/index.js';
const report = await analyseGame(pgn, engine, {
  params: PRESETS.production,
  settings: { dedupeSacrifices: true },
});
```

---

## Using it in an application

**→ [`INTEGRATION.md`](INTEGRATION.md)** is the guide: how to vendor the code,
which two engine files to serve, the API, the performance budget and the GPL
question. The short version:

```js
import { createBrilliantAnalyser } from 'chess-brilliance/browser';

const analyser = createBrilliantAnalyser({
  enginePath: '/engine/stockfish-17.1-lite-single-03e3232.js',
  params: 'production',
});
const report = await analyser.analyse(pgn, { onProgress, signal });
report.brilliants; // [{ ply, moveNumber, color, san, score, features }, …]
```

One analyser per app — it loads the 7 MB engine once and reuses it, queues
concurrent calls, and supports `AbortSignal` cancellation.

`dist/chess-brilliance.js` is a single 113 kB ESM file with `chess.js` inlined
for setups without a bundler. TypeScript declarations are in `types/`.

> **Licence:** Stockfish is GPL-3.0 and a browser build distributes it to every
> visitor, so this package is GPL-3.0 too. Settle that before shipping — see
> [`INTEGRATION.md`](INTEGRATION.md) §0.

---

## Running it

```bash
npm install

# browser demo
npm run serve            # http://localhost:8080/

# command line
node bin/analyse.js game.pgn --depth 20
cat game.pgn | node bin/analyse.js

# benchmark reproduction (engine results are cached in cache/analysis.jsonl)
npm run bench:analyze    # engine pass  (~10 min on 4 cores, cached afterwards)
npm run bench:eval       # recall / extra-detection report
node bench/tune.js       # threshold search + 2-fold cross-validation
node bench/ablate.js     # what each gate costs and saves
node bench/compare-baseline.js   # vs. the freechess (Chess.com replica) rule
node bench/external-rate.js      # calibration on unseen tournament games
node bench/tune-joint.js         # recall vs. external-rate frontier
node bench/timing.js             # single-engine speed
node bench/report.js             # regenerates RESULTS.md

# verify an integration (13 checks incl. a full engine round-trip)
npm test
```

For a static deployment, copy `stockfish-17.1-lite-single-*.js` and its `.wasm`
sibling from `node_modules/stockfish/src/` into `web/vendor/` — then `web/` is a
self-contained static site.

## Layout

```
src/core/board.js       SEE, attackers/defenders, material
src/core/features.js    static sacrifice features + pre-filter
src/core/analysis.js    engine output -> feature vector
src/core/classify.js    the Brilliant gates (the actual "algorithm")
src/core/pgn.js         tolerant PGN reader (chess.com clock comments etc.)
src/engine/uci.js       UCI parsing, MultiPV collection, win-probability model
src/engine/engine-node.js     Stockfish 17.1 Lite in Node
src/engine/engine-browser.js  the same build as a Web Worker
src/index.js            analyseGame() — the public API
web/                    browser demo
bench/                  datasets, engine pool, tuning, evaluation, baselines
```

## Data

| dataset | what it is | role |
| --- | --- | --- |
| `data/chessigma-brilliant-benchmark.json` | 100 Chess.com games, one labelled Brilliant ply each | primary metric |
| `data/twic-external.json` | 300 unseen TWIC tournament games, no labels | false-positive calibration against Chess.com's published 0.1–0.4 % Brilliant rate |
| `data/twic-holdout.json` | a further 300 TWIC games, never used for tuning | confirms the external rate is stable |
| `data/chesscom-verified.json` | one game whose Chess.com game review is known in full (three Brilliants) | the only dataset here where **precision** is measurable |
| `data/annotated-brilliancies.json` | master games where a human annotator wrote `!!` | independent generalisation probe |

See [`RESULTS.md`](RESULTS.md) for the numbers and [`FINDINGS.md`](FINDINGS.md)
for what the research said and which parts of it survived contact with the data.
