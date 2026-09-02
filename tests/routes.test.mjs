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

test('no page or layout reads tenant data during server render', () => {
  // Hosts that split pages and API routes into separate functions give each its own
  // storage, so a record created through the API is invisible to a page that queries the
  // database directly. Every screen must go through the API instead.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'api') walk(full); continue; }
      if (!/^(page|layout)\.jsx$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      // demo.js and demo-seed.js are allowed: the demo workspace is seeded identically
      // in every function, so reading it during render is consistent everywhere.
      if (/from '@\/lib\/(db|envelopes|audit|storage)\.js'/.test(source)) {
        offenders.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(APP_DIR);
  assert.deepEqual(offenders, [], `pages querying the database directly:\n  ${offenders.join('\n  ')}`);
});
