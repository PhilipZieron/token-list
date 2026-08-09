import { createBrilliantAnalyser } from '../src/browser.js';
import { Chess } from './vendor/chess.js';

const els = {
  pgn: document.getElementById('pgn'),
  run: document.getElementById('run'),
  status: document.getElementById('status'),
  bar: document.getElementById('bar'),
  results: document.getElementById('results'),
  depth: document.getElementById('depth'),
  engineInfo: document.getElementById('engine-info'),
};

let analyser = null;
let enginePath = null;

async function findEngine() {
  // The npm package appends a content hash to the filename; try the known one
  // first and fall back to asking the server for a directory listing.
  const candidates = [
    './vendor/stockfish-17.1-lite-single.js',
    '../node_modules/stockfish/src/stockfish-17.1-lite-single-03e3232.js',
  ];
  for (const c of candidates) {
    try {
      const r = await fetch(c, { method: 'HEAD' });
      if (r.ok) return c;
    } catch {}
  }
  throw new Error(
    'Stockfish 17.1 Lite build not found. Copy stockfish-17.1-lite-single-*.js and its .wasm into web/vendor/.'
  );
}

async function ensureAnalyser() {
  if (analyser) return analyser;
  setStatus('loading Stockfish 17.1 Lite (~7 MB) …');
  enginePath = await findEngine();
  analyser = createBrilliantAnalyser({ enginePath, params: 'production' });
  await analyser.ready();
  els.engineInfo.textContent = `engine: ${enginePath.split('/').pop()} (single-threaded WASM)`;
  return analyser;
}

function setStatus(text) {
  els.status.textContent = text;
}

function setProgress(done, total) {
  const pct = total ? Math.round((100 * done) / total) : 0;
  els.bar.style.width = `${pct}%`;
  els.bar.textContent = total ? `${done}/${total}` : '';
}

els.run.addEventListener('click', async () => {
  const pgn = els.pgn.value.trim();
  if (!pgn) return setStatus('paste a PGN first');
  els.run.disabled = true;
  els.results.innerHTML = '';
  try {
    const an = await ensureAnalyser();
    const pre = an.estimate(pgn);
    setStatus(`${pre.plies} plies, ${pre.candidates} sacrifice candidates need the engine`);
    setProgress(0, pre.candidates);

    const depth = Number(els.depth.value);
    const t0 = performance.now();
    const report = await an.analyse(pgn, {
      settings: { deepDepth: depth, afterDepth: depth - 1 },
      onProgress: ({ done, total }) => {
        setProgress(done, total);
        setStatus(`analysing candidate ${done}/${total} …`);
      },
    });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);

    setStatus(
      `${report.brilliants.length} brilliant move(s) in ${report.nPlies} plies ` +
        `— ${report.nCandidates} positions analysed in ${secs}s`
    );
    render(pgn, report);
  } catch (e) {
    console.error(e);
    setStatus(`error: ${e.message}`);
  } finally {
    els.run.disabled = false;
  }
});

function render(pgn, report) {
  const h = report.headers;
  const head = document.createElement('div');
  head.className = 'game-head';
  head.textContent = `${h.White || '?'} (${h.WhiteElo || '?'}) vs ${h.Black || '?'} (${h.BlackElo || '?'})`;
  els.results.appendChild(head);

  if (!report.brilliants.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No brilliant moves found.';
    els.results.appendChild(p);
  }

  for (const b of report.brilliants) {
    els.results.appendChild(card(b, true));
  }

  const rejected = report.candidates.filter((c) => !c.brilliant);
  if (rejected.length) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${rejected.length} sacrifice candidates rejected (why?)`;
    details.appendChild(summary);
    for (const r of rejected) details.appendChild(card(r, false));
    els.results.appendChild(details);
  }
}

function card(move, isBrilliant) {
  const div = document.createElement('div');
  div.className = `card ${isBrilliant ? 'brilliant' : 'rejected'}`;

  const title = document.createElement('div');
  title.className = 'card-title';
  const label = `${move.moveNumber}${move.color === 'w' ? '.' : '...'} ${move.san}`;
  title.innerHTML = isBrilliant
    ? `<span class="badge">!!</span> <strong>${label}</strong> <span class="score">score ${move.score}</span>`
    : `<strong>${label}</strong> <span class="reason">${move.reason}</span>`;
  div.appendChild(title);

  const f = move.features;
  const facts = document.createElement('div');
  facts.className = 'facts';
  facts.textContent =
    `sacrifices ${pieceName(f.sacGross)} (gross ${f.sacGross}, net ${f.sacNet}) · ` +
    `eval after ${fmtCp(f.playedCp)} · best ${fmtCp(f.bestCp)} · 2nd best ${fmtCp(f.secondCp)} · ` +
    `engine rank ${f.playedRank || '>' + 5}`;
  div.appendChild(facts);

  div.appendChild(boardEl(move.fenAfter, move.uci));
  return div;
}

function pieceName(v) {
  if (v >= 900) return 'a queen';
  if (v >= 500) return 'a rook';
  if (v >= 300) return 'a piece';
  if (v >= 100) return 'a pawn';
  return 'material';
}

function fmtCp(cp) {
  if (cp === null || cp === undefined) return '?';
  if (Math.abs(cp) >= 29800) return cp > 0 ? '#' : '-#';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}

const GLYPHS = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

function boardEl(fen, uci) {
  const chess = new Chess();
  chess.load(fen, { skipValidation: true });
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const wrap = document.createElement('div');
  wrap.className = 'board';
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = 'abcdefgh'[c] + (8 - r);
      const cell = document.createElement('div');
      cell.className = `sq ${(r + c) % 2 ? 'dark' : 'light'}`;
      if (sq === from) cell.classList.add('from');
      if (sq === to) cell.classList.add('to');
      const p = board[r][c];
      if (p) cell.textContent = GLYPHS[p.color + p.type];
      wrap.appendChild(cell);
    }
  }
  return wrap;
}

const SAMPLE = `[Event "Live Chess"]
[Site "Chess.com"]
[White "Parthenope"]
[Black "micheletumbarello"]
[Result "1-0"]
[WhiteElo "1791"]
[BlackElo "1967"]

1. e4 d5 2. exd5 Nf6 3. Bb5+ Bd7 4. Be2 c5 5. dxc6 Nxc6 6. d4 g6 7. c4 Bg7 8. Nc3 O-O
9. Be3 Rc8 10. Rc1 b6 11. h3 Bf5 12. Nf3 Na5 13. b3 Ne4 14. Nxe4 Bxe4 15. Ng5 Bxg2
16. Rg1 Bb7 17. h4 Qd6 18. h5 e5 19. d5 Rfd8 20. Bd3 Rd7 21. Qg4 f5 22. Qh3 f4
23. hxg6 fxe3 24. Qxh7+ Kf8 25. Ne6+ Qxe6 26. dxe6 exf2+ 27. Kxf2 Rxd3 28. Ke2 e4
29. Rcf1+ Rf3 30. Rxf3+ exf3+ 31. Kf1 Re8 32. Rg5 Rxe6 33. Rf5+ Rf6 34. Rxf6+ Bxf6
35. Qf7# 1-0`;

document.getElementById('sample').addEventListener('click', () => {
  els.pgn.value = SAMPLE;
});
