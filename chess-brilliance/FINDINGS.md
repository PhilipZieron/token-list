# Research notes — what a "Brilliant move" actually is, and what survived contact with the data

## 1. Chess.com's own description

Chess.com's Help Centre and its 2023/24 rewrite of the classifier describe the badge as:

* Brilliant is awarded **when you find a good piece sacrifice**. The earlier, more
  elaborate algorithm was replaced with this simpler definition.
* The move must be **good** — Chess.com's classifier works on an **expected-points**
  model rather than raw centipawns. Their published tiers: *Best* = no loss of win
  probability, *Excellent* ≤ 2 % loss, *Good* = 2–5 % loss.
* The evaluation must **remain favourable** after the sacrifice.
* The sacrifice must be **necessary** — if a quiet alternative was already
  completely winning, no badge.
* Brilliant is the **rarest** classification: community and Chess.com "Insights"
  data put it at roughly **0.1–0.4 % of all moves played**, even for strong players.

The expected-points conversion is the standard logistic used across the ecosystem:

```
win% = 100 / (1 + exp(-0.00368208 · centipawns))
```

which is implemented in [`src/engine/uci.js`](src/engine/uci.js).

## 2. The best open-source replica: `WintrCat/freechess`

`freechess` is the most complete public reconstruction of Chess.com's report. Its
Brilliant branch requires **all** of:

1. the move is the engine's **top** move,
2. evaluation after the move ≥ 0 for the mover,
3. not "winning anyway" — second-best < 700 cp (when the top line is a cp score),
   or both top lines are mate,
4. not a promotion,
5. the mover was **not in check** before the move,
6. some non-king, non-pawn piece of the mover is **hanging** afterwards, judged by
   an attacker/defender count rather than by static exchange evaluation,
7. that piece is **viably capturable** — the capture must be legal, must not merely
   hang a bigger enemy piece, and for sacrifices smaller than a rook must not allow
   mate in 1.

**Measured here on identical Stockfish output: 44 / 100 on the Chessigma benchmark.**
It is far too strict — mostly because of requirement 1 (top move only) and because
its 700 cp rule is applied in cases where Chess.com evidently still awards the badge.

Its `isPieceHanging` heuristic is nevertheless instructive: it counts attackers and
defenders instead of running an exchange evaluation, which is *more* permissive than
SEE in one specific way — see §8.

## 3. Zaidi & Guerzhoy, *Predicting User Perception of Move Brilliance in Chess* (ICCC 2024, arXiv:2406.11895)

The first published system for classifying moves as brilliant. Summary of what it does:

* **Data**: 8,574 games from the 624 most popular Lichess *studies*; 820 moves that
  users annotated as brilliant.
* **Features**: search trees are generated from the position before the move with
  **Leela Chess Zero** (superhuman) and **Maia** (trained on human games at fixed
  rating bins), at node budgets of 10¹ … 10⁵. Features describe the *shape* — width
  and height — of the sub-trees, plus the engines' evaluations.
* **Model**: a neural network over those features.
* **Result**: 79 % accuracy at a 50 % base rate, PPV 83 %, NPV 75 %.
* **Headline insight**: *a move is more likely to be perceived as brilliant when a
  weaker engine rates it poorly while a stronger engine rates it highly.* Brilliance
  is not "the best move" — it is the **gap between weak and strong evaluation**.

### Did that signal transfer here? No — and that is itself a finding.

The insight is implemented as a first-class feature: a deliberately weak search
(depth 8, MultiPV 5) on the position before the move, giving `shallowRank` and
`shallowLoss` (see [`src/core/analysis.js`](src/core/analysis.js)).

Measured on the benchmark, **conditioning on move quality** so the comparison is not
confounded (all sacrifice candidates with expected-points loss ≤ 2 %):

| | P(weak engine does *not* rank the move first) |
| --- | --- |
| labelled Brilliant (n = 79) | 0.38 |
| unlabelled sacrifice candidates (n = 195) | 0.43 |

The signal is flat — very slightly the *wrong* way. Using it as a hard gate collapses
recall from 99/100 to 45/100.

The explanation is that the two tasks are different targets:

* the paper predicts **human-perceived** brilliance, labelled by Lichess users on
  curated study positions;
* the Chess.com badge is a **rule-based sacrifice detector** applied to every game.

Chess.com does not model surprise at all — it checks whether material was given away
soundly. So the gate stays implemented and documented, but **off by default**, and is
the right thing to switch on for a "human-perception" mode rather than a
"reproduce Chess.com" mode.

## 4. What the 100 labelled moves actually look like

Derived directly from the benchmark (`node bench/prefilter-stats.js`):

* **Ply indexing.** The benchmark's `ply` field is 1-based (ply 1 = White's first
  move). Under that reading 99/100 labelled moves give away ≥ 300 cp of material;
  under 0-based indexing only 29 % do.
* **Every labelled Brilliant sacrifices at least a minor piece.** Gross value of the
  material offered: 300 cp ×69, 500 cp ×15, 900 cp ×15. **There is not a single
  pawn-only sacrifice.** This justifies the `sacGross ≥ 300` gate and matches
  freechess skipping pawns.
* **They are not all the engine's best move.** 31 labelled Brilliants are outside
  Stockfish 17.1 Lite's top choice at depth 20, with expected-points losses up to
  8.5 %. Re-running them at depth 24 barely moved them — and §5 shows the full
  engine does not rescue them either.
* **Promotions, mate-in-N positions and "already winning" positions are all
  represented** among the labels, contradicting three of freechess's hard exclusions.
* Ratings span 428–3186 (median 1075), time controls mostly 900+10 and 600.

## 5. Is the loose quality gate just Stockfish Lite being weak?

The single most surprising thing in §4 is that Chess.com badges moves that are not
the engine's best. That could have two explanations: Chess.com's threshold really
is loose, or Stockfish 17.1 **Lite** simply disagrees with a stronger engine.

Tested directly by re-running every labelled Brilliant that Lite does not rank
first through **full-strength Stockfish 17.1** (the 79 MB non-Lite NNUE build,
same depth 20, MultiPV 5):

| | |
| --- | --- |
| labelled Brilliants that are not Lite's top move | 31 / 100 |
| of those, promoted to top move by the full engine | **2** |
| improved in rank at all | 8 |

So it is not an engine artefact. Chess.com genuinely awards Brilliant to moves its
classifier merely rates as *good*, and any rule that demands the engine's top move
is capped at roughly half the labels — which is exactly where freechess lands.

That single design decision is what separates 44/100 from 96/100.

## 6. Detection rate, and why precision cannot be measured here

The benchmark contains only positives — one labelled Brilliant per game — so
"extra detections" are an upper bound on false positives, not a count of them.
Two independent calibrations were used instead:

| | benchmark recall | rate on 300 unseen tournament games | rate on a further 300 held out |
| --- | --- | --- | --- |
| freechess rule | 44/100 | 0.448 % | 0.472 % |
| this project (default) | 96/100 | 1.545 % | 1.638 % |

The two external corpora agree to within 0.1 percentage points, so the rate is a
stable property of the classifier and not an artefact of one sample.

Chess.com's published player statistics put Brilliant at ~0.1–0.4 % of moves. Both
systems sit above that, and the gap is expected rather than alarming: that figure
counts badges earned by mostly-amateur members who usually *fail* to find the
sound sacrifice, whereas these corpora are 2400+ tournament games in which the
strong move actually gets played. freechess-on-the-same-corpus is therefore the
meaningful yardstick: this project detects 2.2× more true Brilliants for 3.5× the
detection rate.

Anyone who wants freechess-like selectivity can have it — `PRESETS['top-move-only']`
reproduces that behaviour, and the whole frontier is in `RESULTS.md`.

## 7. Standing sacrifices are reported once per ply

Every ply is classified independently, which is right for games containing several
Brilliants — 56 of the 100 benchmark games get two or more detections — but has one
failure mode: a sacrifice the opponent **declines** remains en prise, so each
following move is also "a move after which a piece is hanging".

Benchmark game #85 (Blitzstream 2943 – MrTattaglia 3039) is the extreme case: nine
consecutive detections, `12.f5 … 23.Bg5`, describing what is really one sustained
piece sacrifice. Chess.com badges only the move that creates the offer.

`settings.dedupeSacrifices` collapses repeats of the same player's same-valued piece
on the same square into the earliest ply:

| | detections | benchmark labels found | rate on external corpus |
| --- | --- | --- | --- |
| off (default) | 185 | 96/100 | 1.545 % |
| on | 165 | 94/100 | 1.373 % |

Keeping the *earliest* ply beats keeping the highest-scoring one (94 vs 93 labels),
which is itself evidence that Chess.com's badge goes to the move that creates the
offer rather than to the sharpest position along the way.

It is off by default because it is a judgement call rather than a documented
Chess.com rule, and because it costs two labels.

## 8. The one Brilliant a static exchange evaluation cannot see

Game #47, `23...Rf1+`: the rook lands on a square attacked by a rook and the king,
and defended by a rook. SEE says the exchange is exactly **0** — no material is
objectively lost — so no sacrifice is detected. Chess.com's attacker-count heuristic
(2 attackers vs 1 defender ⇒ "hanging") does flag it.

This is a real, systematic difference between the two notions of "sacrifice". The
attacker-count rule would recover this move, at the cost of also treating every
ordinary defended-piece offer as a sacrifice, so the SEE definition is kept and this
counts as an accepted miss.

## 9. Engine choice

Stockfish **17.1 Lite**, single-threaded WASM (~7 MB), is used everywhere — including
for the benchmark numbers — so that measured results transfer to the browser build
exactly. The Lite NNUE is weaker than full Stockfish, which is visible in §4: some
Chess.com Brilliants are not Lite's top move. Deeper search does not close that gap,
so the classifier's quality gate is set in expected-points terms with enough slack to
absorb it.

## Sources

* [Chess.com Help Centre — How are moves classified?](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc)
* [Chess.com Help Centre — How is accuracy determined?](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined)
* [WintrCat/freechess](https://github.com/WintrCat/freechess) — open-source Chess.com report replica
* [Zaidi & Guerzhoy, *Predicting User Perception of Move Brilliance in Chess*, arXiv:2406.11895](https://arxiv.org/abs/2406.11895) ([ICCC 2024 paper](https://computationalcreativity.net/iccc24/papers/ICCC24_paper_200.pdf))
* [U of T — What makes a chess move brilliant?](https://www.utoronto.ca/news/what-makes-chess-move-brilliant-researchers-use-ai-find-out)
* [Chessigma — What is a Brilliant Move in Chess?](https://www.chessigma.com/blog/brilliant-move-chess) and their [Brilliant benchmark](https://www.chessigma.com/benchmarks/brilliant)
* [How rare are "brilliant" moves according to Chess.com's analysis?](https://www.chess.com/forum/view/general/how-rare-are-brilliant-moves-according-to-chess-coms-analysis)
* [Science of Chess: What makes a move seem "Brilliant?"](https://lichess.org/@/NDpatzer/blog/science-of-chess-what-makes-a-move-seem-brilliant/wtFdMXzO)
* [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) — the WASM build used here
