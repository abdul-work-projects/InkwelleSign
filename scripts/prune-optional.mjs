/**
 * Removes optional npm packages that carry licences outside the project policy.
 *
 * `sharp` (and its @img/* platform binaries) ship libvips under LGPL-3.0. Next.js
 * lists sharp as an *optional* dependency used solely by `next/image` runtime image
 * optimisation, which this application does not use — `images.unoptimized` is set in
 * next.config.mjs. Removing it keeps the dependency tree inside the permissive
 * allow-list without affecting any feature.
 *
 * Runs automatically on `npm install` via the postinstall hook.
 */
import fs from 'node:fs';
import path from 'node:path';

const REMOVE = ['sharp', '@img'];
const modules = path.join(process.cwd(), 'node_modules');
let removed = 0;

for (const name of REMOVE) {
  const target = path.join(modules, name);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    removed++;
    console.log(`pruned node_modules/${name} (LGPL-3.0 — outside licence policy, unused)`);
  }
}

if (!removed) console.log('prune-optional: nothing to remove.');
