/**
 * Engine pass: analyse every sacrifice candidate at three settings
 *   - deep   : MultiPV on the position *before* the move (move quality + alternatives)
 *   - after  : the position *after* the move (evaluation of the played move)
 *   - shallow: a deliberately weak search, for the "weak engine disagrees with
 *              strong engine" brilliance signal from Zaidi & Guerzhoy (2024)
 *
 * Results land in cache/analysis.jsonl and are reused by later runs.
 */
import { buildRecords, loadDataset } from './dataset.js';
import { runJobs } from './engine-pool.js';

export const SETTINGS = {
  deepDepth: Number(process.env.DEEP_DEPTH || 20),
  deepMultiPv: Number(process.env.DEEP_MPV || 5),
  afterDepth: Number(process.env.AFTER_DEPTH || 19),
  afterMultiPv: Number(process.env.AFTER_MPV || 2),
  shallowDepth: Number(process.env.SHALLOW_DEPTH || 8),
  shallowMultiPv: Number(process.env.SHALLOW_MPV || 5),
};

export function jobsForCandidates(candidates, s = SETTINGS) {
  const jobs = [];
  for (const c of candidates) {
    jobs.push({ fen: c.fenBefore, depth: s.deepDepth, multiPv: s.deepMultiPv });
    jobs.push({ fen: c.fenAfter, depth: s.afterDepth, multiPv: s.afterMultiPv });
    jobs.push({ fen: c.fenBefore, depth: s.shallowDepth, multiPv: s.shallowMultiPv });
  }
  return jobs;
}

async function main() {
  const datasets = (process.env.DATASETS || 'chessigma-brilliant-benchmark.json').split(',');
  const workers = Number(process.env.WORKERS || 4);
  const limit = Number(process.env.LIMIT || 0);

  let all = [];
  for (const name of datasets) {
    const games = loadDataset(name.trim());
    const sliced = limit ? games.slice(0, limit) : games;
    const { candidates } = buildRecords(sliced, { source: name.replace(/\.json$/, '') });
    console.log(`${name}: ${sliced.length} games -> ${candidates.length} candidates`);
    all = all.concat(candidates);
  }

  const jobs = jobsForCandidates(all);
  await runJobs(jobs, { workers, label: datasets.join(',') });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
