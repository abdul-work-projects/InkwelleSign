/**
 * Container entrypoint: optionally seed an empty database, then start Next.
 *
 * SEED_ON_START=1 populates the demo workspace only when no organisation exists,
 * so a restart or redeploy never overwrites real data.
 */
import { spawn } from 'node:child_process';

if (process.env.SEED_ON_START === '1') {
  try {
    const { db } = await import('../lib/db.js');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM organizations').get();
    if (n === 0) {
      console.log('[start] empty database — seeding the demo workspace');
      await import('./seed.mjs');
    } else {
      console.log(`[start] ${n} organisation(s) present — not seeding`);
    }
  } catch (err) {
    console.error('[start] seeding skipped:', err.message);
  }
}

const port = process.env.PORT || '3000';
const next = spawn('node_modules/.bin/next', ['start', '-p', port], {
  stdio: 'inherit',
  env: process.env,
});
next.on('exit', (code) => process.exit(code ?? 0));
