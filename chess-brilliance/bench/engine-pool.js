/**
 * Parallel Stockfish analysis with an append-only disk cache.
 *
 * The cache means the (expensive) engine pass runs once; every later
 * classifier tuning iteration reads from disk in milliseconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(__dirname, '../cache');

export function cacheKey(fen, depth, multiPv) {
  return `${depth}|${multiPv}|${fen}`;
}

export function loadCache(file = 'analysis.jsonl') {
  const p = path.join(CACHE_DIR, file);
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      map.set(cacheKey(rec.fen, rec.depth, rec.multiPv), rec);
    } catch {}
  }
  return map;
}

export function appendCache(records, file = 'analysis.jsonl') {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const p = path.join(CACHE_DIR, file);
  fs.appendFileSync(p, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/**
 * @param {Array<{fen:string, depth:number, multiPv:number}>} jobs
 */
export async function runJobs(jobs, { workers = 4, cacheFile = 'analysis.jsonl', label = '' } = {}) {
  const cache = loadCache(cacheFile);
  const todo = [];
  const seen = new Set();
  for (const j of jobs) {
    const k = cacheKey(j.fen, j.depth, j.multiPv);
    if (cache.has(k) || seen.has(k)) continue;
    seen.add(k);
    todo.push(j);
  }
  if (todo.length === 0) {
    console.log(`[pool${label ? ' ' + label : ''}] all ${jobs.length} jobs cached`);
    return cache;
  }
  console.log(`[pool${label ? ' ' + label : ''}] ${todo.length} new jobs (of ${jobs.length}) on ${workers} workers`);

  // Interleave so every worker gets a similar depth mix.
  const shards = Array.from({ length: workers }, () => []);
  todo.forEach((j, i) => shards[i % workers].push(j));

  const t0 = Date.now();
  let done = 0;
  const results = [];

  await Promise.all(
    shards.map(
      (shard, i) =>
        new Promise((resolve, reject) => {
          if (shard.length === 0) return resolve();
          const child = fork(path.join(__dirname, 'worker.js'), [], {
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          });
          child.on('message', (msg) => {
            if (msg.type === 'result') {
              results.push(msg.record);
              done++;
              if (done % 25 === 0 || done === todo.length) {
                const rate = done / ((Date.now() - t0) / 1000);
                const eta = (todo.length - done) / rate;
                process.stdout.write(
                  `\r[pool] ${done}/${todo.length}  ${rate.toFixed(1)}/s  eta ${Math.round(eta)}s   `
                );
              }
              if (results.length >= 20) {
                appendCache(results.splice(0, results.length), cacheFile);
              }
            } else if (msg.type === 'done') {
              child.kill();
              resolve();
            } else if (msg.type === 'error') {
              console.error(`\n[worker ${i}] ${msg.message}`);
            }
          });
          child.on('error', reject);
          child.send({ type: 'jobs', jobs: shard });
        })
    )
  );

  if (results.length) appendCache(results, cacheFile);
  process.stdout.write('\n');
  console.log(`[pool] finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return loadCache(cacheFile);
}
