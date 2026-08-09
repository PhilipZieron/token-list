# Integrating into an application

Everything needed to drop this into Chessgalaxy. Three parts: **get the code
in**, **serve the engine files**, **call the API**.

---

## 0. Before you start: the licence

Stockfish is **GPL-3.0**, and a browser build means you *distribute* it to every
visitor. That triggers the GPL's source-offer obligation for the work you ship.
This package is therefore GPL-3.0 too.

If Chessgalaxy is closed-source, resolve this *before* launch. The usual options:

* keep the engine in a separate, clearly-GPL bundle and publish that source, or
* run the engine server-side (the GPL is not triggered by network use alone), or
* pick a non-GPL engine.

Not legal advice — but it is a real constraint, not a formality.

---

## 1. Get the code in

### Option A — copy the folder (simplest, no registry)

Copy `src/` and `types/` into your repo, e.g. `src/lib/brilliance/`, then:

```bash
npm install chess.js stockfish
```

`src/` imports nothing except `chess.js` (and `node:*` in the Node adapter,
which your bundler will never touch if you import the browser entry point).

### Option B — as a dependency

```jsonc
// package.json
"dependencies": {
  "chess-brilliance": "github:PhilipZieron/token-list#path:/chess-brilliance"
}
```

or publish it to a private registry. Entry points:

| import | what you get |
| --- | --- |
| `chess-brilliance/browser` | `createBrilliantAnalyser` on a Web Worker |
| `chess-brilliance/node` | same API, Node adapter |
| `chess-brilliance/core` | `analyseGame()` + classifier, bring your own engine |
| `chess-brilliance/bundle` | `dist/chess-brilliance.js`, everything inlined |

### Option C — no build step at all

`dist/chess-brilliance.js` (113 kB, or 50 kB minified) is a single ESM file with
`chess.js` already inlined:

```html
<script type="module">
  import { createBrilliantAnalyser } from '/vendor/chess-brilliance.js';
</script>
```

Rebuild it after changing `src/` with `npm run build`.

---

## 2. Serve the engine files

Copy **two files** out of `node_modules/stockfish/src/` into whatever your app
serves statically:

```
stockfish-17.1-lite-single-03e3232.js     ~20 kB
stockfish-17.1-lite-single-03e3232.wasm   ~7 MB
```

They must end up **next to each other** — the loader finds the `.wasm` relative
to the `.js`. Rename both if you like, as long as the basenames still match.

The npm package is >100 MB because it contains every Stockfish flavour. Only
these two ship. A `postinstall` copy step keeps that automatic:

```jsonc
"scripts": {
  "copy:engine": "cp node_modules/stockfish/src/stockfish-17.1-lite-single-*.{js,wasm} public/engine/",
  "postinstall": "npm run copy:engine"
}
```

Serving notes:

* `.wasm` must be served as `application/wasm`, otherwise streaming
  instantiation falls back to a slower path (or fails on some servers).
* Cache it hard — `Cache-Control: public, max-age=31536000, immutable`. The
  content hash in the filename makes that safe.
* **No COOP/COEP headers needed.** The single-threaded Lite build is chosen
  precisely so cross-origin isolation is not required. If you ever switch to the
  multi-threaded build (≈3–4× faster) you must add
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, which affects every embed on the
  page.

---

## 3. Call it

```js
import { createBrilliantAnalyser } from 'chess-brilliance/browser';

const analyser = createBrilliantAnalyser({
  enginePath: '/engine/stockfish-17.1-lite-single-03e3232.js',
  params: 'production',            // recommended preset
  settings: { dedupeSacrifices: true },
});

// Optional: start the 7 MB download early, e.g. when the analysis page mounts.
analyser.ready();

const report = await analyser.analyse(pgn, {
  onProgress: ({ done, total }) => setProgress(done / total),
  signal: abortController.signal,
});

for (const move of report.brilliants) {
  console.log(`${move.moveNumber}${move.color === 'w' ? '.' : '...'}${move.san}`);
}
```

### The report

```ts
{
  headers: { White, Black, WhiteElo, … },   // straight from the PGN
  nPlies: 61,
  nCandidates: 7,        // positions the engine actually looked at
  brilliants: [ … ],     // the !! moves
  candidates: [ … ],     // every sacrifice candidate, with `reason` if rejected
}
```

Each move carries `ply` (1-based), `moveNumber`, `color`, `san`, `uci`,
`fenBefore`, `fenAfter`, `score` (0–1 confidence, for ranking) and `features` —
which is what you build UI copy from:

```js
const f = move.features;
`Sacrifices ${f.sacGross / 100} points of material; ` +
`evaluation stays at ${(f.playedCp / 100).toFixed(2)}.`
```

`candidates` is worth surfacing in a debug view: every rejected move has a
`reason` (`losing-after`, `winning-anyway`, `king-move`, …), which makes "why
didn't my move get a badge?" answerable instead of mysterious.

### Lifecycle

One analyser per app, not one per game — the engine costs 7 MB and ~300 ms to
start, and it is reused.

```js
await analyser.ready();     // idempotent; safe to call repeatedly
analyser.estimate(pgn);     // { plies, candidates, searches } without the engine
await analyser.analyse(…);  // queued: concurrent calls run one after another
await analyser.dispose();   // waits for queued work, then frees the engine
```

Cancellation is cooperative: an `AbortSignal` stops the analysis after the
current search finishes and rejects with `AnalysisCancelled`. The engine stays
usable afterwards — do **not** terminate the worker mid-search instead, that
crashes the WASM instance.

### Presets

| preset | benchmark recall | detections/game | use for |
| --- | --- | --- | --- |
| `recall` | 98/100 | 1.04 | "find everything", research |
| `balanced` | 96/100 | 0.89 | the library default |
| **`production`** | **94/100** | **0.71** | **user-facing apps** |
| `strict` | 83/100 | 0.72 | when a `!!` should feel rare |
| `top-move-only` | 58/100 | 0.40 | matching the freechess replica |

Override anything per call:

```js
analyser.analyse(pgn, { params: { ...PRESETS.production, maxSecondCp: 550 } });
```

---

## 4. Performance budget

Measured single-threaded, depth 20, on one core:

| | |
| --- | --- |
| engine start | ~300 ms |
| per candidate position | ~2 s (two searches) |
| typical game | 15–30 s |
| sharp, sacrifice-heavy game | up to ~60 s |

Only ~6 % of plies reach the engine, so cost tracks the number of sacrifices,
not game length. Levers if that is too slow:

* `settings.deepDepth: 16` — roughly 3× faster, costs a little accuracy.
* Multi-threaded Lite build — 3–4× faster, needs COOP/COEP (see above).
* Cache reports by game ID. The analysis is deterministic for a given
  depth **as long as the engine hash is not reused across games**; if you need
  byte-identical repeat results, create a fresh analyser per game or clear the
  hash between games.
* Analyse server-side for bulk work and ship the result as JSON.

---

## 5. What this is *not*

This detects **Brilliant** only. A full Chess.com-style game review also needs
Best / Excellent / Good / Book / Inaccuracy / Mistake / Miss / Blunder / Great /
Forced, plus an accuracy score.

That is mostly straightforward rule work on top of the same engine output — but
note the cost model changes completely: those tiers need **every** position
analysed, not the ~6 % this pre-filters down to. Budget ~3 minutes per game at
depth 20 single-threaded, and design for background/server analysis accordingly.

One open question worth knowing about: some of this classifier's false positives
are probably Chess.com **Great Moves** (`!`), which is mutually exclusive with
Brilliant. Implementing Great may therefore *improve* Brilliant precision rather
than just adding a category. See `FINDINGS.md` §7.

---

## 6. Verifying the integration

```bash
npm test
```

Runs 13 checks including a full engine round-trip on a game whose Chess.com
badges are known, and will fail loudly if the engine files cannot be resolved.
