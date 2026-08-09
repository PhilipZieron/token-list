# Results

All numbers below are produced by `node bench/report.js` from the cached Stockfish 17.1 Lite runs (depth 20, MultiPV 5; depth 19 MultiPV 2 for the position after the move).

## 1. Static pre-filter (no engine)

| | value |
| --- | --- |
| plies in the 100 benchmark games | 7552 |
| plies that reach the engine | 509 (6.7 %) |
| labelled Brilliants kept | 99 / 100 |

The one Brilliant the pre-filter drops is game #47, `23...Rf1+`: an *equal-value* rook offer (SEE 0 — the rook is defended, so no material is objectively lost). Chess.com's attacker/defender count treats it as hanging; a static exchange evaluation does not.

## 2. Operating points

"Extra detections" are Brilliant calls on plies the benchmark does not label. The benchmark labels exactly **one** Brilliant per game, so this is an *upper bound* on false positives, not a measured false-positive count.

| preset | benchmark recall | extra detections / game | tuning corpus rate | holdout corpus rate | annotated `!!` sacs |
| --- | --- | --- | --- | --- | --- |
| `recall` | **98/100** | 1.04 | 1.761 % | 1.802 % | 10/12 |
| `balanced` *(default)* | **96/100** | 0.89 | 1.545 % | 1.638 % | 8/12 |
| `strict` | **83/100** | 0.72 | 1.249 % | 1.297 % | 7/12 |
| `top-move-only` | **58/100** | 0.40 | 0.952 % | 0.955 % | 6/12 |

Chess.com's own published player statistics put Brilliant moves at roughly **0.1–0.4 % of all moves**. The external corpus (300 unseen TWIC tournament games, 24987 plies) is the calibration against that figure — the benchmark games cannot serve this purpose because they were *selected* for containing a Brilliant.

## 3. Baseline comparison

| system | benchmark recall | extra detections / game | tuning corpus rate | holdout corpus rate |
| --- | --- | --- | --- | --- |
| Chessigma (self-reported) | 93/100 | not published | n/a | n/a |
| freechess rule (Chess.com replica), same engine output | 44/100 | 0.09 | 0.448 % | 0.472 % |
| **this project (default `balanced`)** | **96/100** | 0.89 | 1.545 % | 1.638 % |

## 4. Where the misses come from

The default preset misses 4 of the analysed positives, plus 1 dropped by the pre-filter.

| game | ply | move | rejected by | detail |
| --- | --- | --- | --- | --- |
| 22 | 22 | Nxg4 | `losing-after` | best -0.31, 2nd -0.75, played -0.75, EP loss 4.0 % |
| 47 | 46 | Rf1+ | `no-piece-sacrifice` | best +5.14, 2nd +3.30, played +5.14, EP loss 0.0 % |
| 84 | 50 | Rxb4 | `was-in-check` | best -0.24, 2nd -0.35, played -0.24, EP loss 0.0 % |
| 95 | 100 | e1=Q+ | `promotion` | best +10.60, 2nd +10.50, played +9.15, EP loss 1.3 % |

## 5. Runtime

Measured with a single engine and nothing else running (`node bench/timing.js`), 8 games / 521 plies / 35 candidates:

| | value |
| --- | --- |
| engine load (7 MB WASM) | 324 ms |
| per search (depth 20, MultiPV 5, 1 thread) | 1969 ms |
| **per game** | **17.2 s** |

Cost scales with the number of sacrifices in a game, not its length — only 6.7 % of plies reach the engine. Measured end-to-end in headless Chromium on the sample game (69 plies, 3 candidates) at depth 18: **5.5 s**, engine load included.
