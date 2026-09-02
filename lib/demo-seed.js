import { DEMO_MODE } from './db.js';

/**
 * Ensures a demo instance has its sample workspace before serving a request.
 *
 * Demo storage is temporary and per function instance, so a cold start begins empty.
 * This runs once per instance — the promise is memoised, so concurrent requests during a
 * cold start wait on the same seed rather than racing to build one each.
 *
 * Deliberately not done from instrumentation.js: Next compiles that file for the edge
 * runtime as well, and the seed reaches better-sqlite3 and nodemailer, neither of which
 * can be resolved there.
 */
let seeding = null;

export async function ensureDemoSeeded() {
  if (!DEMO_MODE) return;
  if (!seeding) {
    seeding = (async () => {
      try {
        const { seedDemoWorkspace, isEmpty } = await import('./seed.js');
        if (isEmpty()) {
          const started = Date.now();
          await seedDemoWorkspace({ quiet: true });
          console.log(`[demo] seeded workspace in ${Date.now() - started}ms`);
        }
      } catch (err) {
        // Serving an empty app beats failing the request outright.
        console.error('[demo] seeding failed:', err?.message || err);
        seeding = null;
      }
    })();
  }
  return seeding;
}
