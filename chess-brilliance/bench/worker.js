import { createEngine, analyseFen } from '../src/engine/engine-node.js';

let engine = null;

process.on('message', async (msg) => {
  if (msg.type !== 'jobs') return;
  try {
    engine = await createEngine({ hashMb: 64 });
    for (const job of msg.jobs) {
      try {
        const t0 = Date.now();
        const lines = await analyseFen(engine, job.fen, {
          depth: job.depth,
          multiPv: job.multiPv,
          timeoutMs: 600000,
        });
        process.send({
          type: 'result',
          record: {
            fen: job.fen,
            depth: job.depth,
            multiPv: job.multiPv,
            ms: Date.now() - t0,
            lines: lines.map((l) => ({
              move: l.move,
              cp: l.cp,
              score: l.score,
              depth: l.depth,
              pv: l.pv.slice(0, 8),
            })),
          },
        });
      } catch (e) {
        process.send({ type: 'error', message: `${job.fen} d${job.depth}: ${e.message}` });
        // A wedged engine must not poison the rest of the shard.
        try {
          engine.quit();
        } catch {}
        engine = await createEngine({ hashMb: 64 });
      }
    }
  } catch (e) {
    process.send({ type: 'error', message: e.stack || String(e) });
  } finally {
    try {
      engine?.quit();
    } catch {}
    process.send({ type: 'done' });
  }
});
