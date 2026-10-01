import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source';
import { runWorker, simulatedHandler } from './worker';

// demo:workers — пул воркерів (Promise-и в одному процесі, кожен зі своїм
// з'єднанням/транзакцією) розбирає чергу jobs через FOR UPDATE SKIP LOCKED.

const JOBS = 40;
const WORKERS = 4;
const JOB_MS = 100;
const KIND = 'demo_work';

async function main(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions({ extra: { max: WORKERS + 4 } }));
  await ds.initialize();
  try {
    await ds.query(`DELETE FROM jobs WHERE kind = $1`, [KIND]);
    await ds.query(
      `INSERT INTO jobs (kind, payload) SELECT $1, jsonb_build_object('n', g) FROM generate_series(1, $2::int) g`,
      [KIND, JOBS],
    );

    const started = Date.now();
    const handled = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => runWorker(ds, `worker-${i + 1}`, simulatedHandler(JOB_MS), KIND)),
    );
    const elapsed = Date.now() - started;

    const perWorker: Array<{ worker_id: string; n: number }> = await ds.query(
      `SELECT worker_id, count(*)::int AS n FROM jobs WHERE kind = $1 GROUP BY worker_id ORDER BY worker_id`,
      [KIND],
    );
    const stats = (
      await ds.query(
        `SELECT count(*) FILTER (WHERE status = 'done' AND processed = 1)::int AS once,
                count(*) FILTER (WHERE processed > 1)::int AS twice,
                count(*) FILTER (WHERE processed = 0)::int AS never
           FROM jobs WHERE kind = $1`,
        [KIND],
      )
    )[0];
    const sequentialMs = JOBS * JOB_MS;

    console.log(`задач: ${JOBS}, воркерів: ${WORKERS}, тривалість однієї: ${JOB_MS} мс`);
    console.log('розподіл по воркерах:');
    for (const w of perWorker) console.log(`  ${w.worker_id}: ${w.n}`);
    console.log(`оброблено рівно раз: ${stats.once}`);
    console.log(`оброблено двічі: ${stats.twice}`);
    console.log(`не оброблено: ${stats.never}`);
    console.log(`загальний час: ${elapsed} мс (послідовно було б ${sequentialMs} мс)`);

    const problems: string[] = [];
    if (stats.twice !== 0) problems.push(`${stats.twice} задач оброблено більше ніж раз`);
    if (stats.never !== 0) problems.push(`${stats.never} задач не оброблено`);
    if (stats.once !== JOBS) problems.push(`рівно раз оброблено ${stats.once} із ${JOBS}`);
    if (handled.reduce((a, b) => a + b, 0) !== JOBS) problems.push('сума лічильників воркерів ≠ кількості задач');
    if (perWorker.length < 2) problems.push('задачі обробив лише один воркер');
    if (elapsed >= sequentialMs) problems.push('пул не швидший за послідовну обробку');

    if (problems.length > 0) {
      console.error(`ПЕРЕВІРКА НЕ ПРОЙДЕНА:\n - ${problems.join('\n - ')}`);
      process.exitCode = 1;
    } else {
      console.log('OK: кожну задачу оброблено рівно один раз, пул швидший за послідовний.');
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('demo:workers впав:', err);
  process.exit(1);
});
