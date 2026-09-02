/**
 * Runs once when a server instance starts.
 *
 * In demo mode the database lives in the instance's temporary directory, so a cold start
 * begins with nothing. Seeding here means every instance serves a populated workspace
 * rather than an empty one, without the first visitor waiting on it mid-request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { DEMO_MODE } = await import('./lib/db.js');
  if (!DEMO_MODE) return;

  try {
    const { seedDemoWorkspace, isEmpty } = await import('./lib/seed.js');
    if (!isEmpty()) return;
    const started = Date.now();
    await seedDemoWorkspace({ quiet: true });
    console.log(`[demo] seeded workspace in ${Date.now() - started}ms`);
  } catch (err) {
    // A failed seed must not take the server down; the app still serves, just empty.
    console.error('[demo] seeding failed:', err?.message || err);
  }
}
