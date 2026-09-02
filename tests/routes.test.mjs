import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempStore } from './helpers.mjs';
useTempStore('routes');

const APP_DIR = path.join(process.cwd(), 'app');

function routeFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, found);
    else if (entry.name === 'route.js') found.push(full);
  }
  return found;
}

/**
 * The wrappers do more than tidy error handling: they seed a demo instance before the
 * handler runs, and they turn a storage failure into 503 with an explanation. A handler
 * that declares its own exports skips both — which is how demo sign-in ended up
 * reporting "not available" on a cold serverless function that had never been seeded.
 */
test('every API route handler goes through an api.js wrapper', () => {
  const offenders = [];
  for (const file of routeFiles(path.join(APP_DIR, 'api'))) {
    const source = fs.readFileSync(file, 'utf8');
    const exportsHandler = /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(source);
    const wrapped = /(withAuth|withPublic|withRoute)\s*\(/.test(source);
    if (exportsHandler || !wrapped) {
      offenders.push(`${path.relative(process.cwd(), file)}${exportsHandler ? ' (bare export)' : ' (no wrapper)'}`);
    }
  }
  assert.deepEqual(offenders, [], `unwrapped handlers:\n  ${offenders.join('\n  ')}`);
});

test('server components that read demo availability seed first', () => {
  // These render demoLogin() directly, so an unseeded instance would hide the button.
  for (const page of ['app/login/page.jsx', 'app/page.jsx', 'app/(app)/layout.jsx']) {
    const source = fs.readFileSync(path.join(process.cwd(), page), 'utf8');
    assert.match(source, /ensureDemoSeeded\(\)/, `${page} must await ensureDemoSeeded()`);
  }
});
