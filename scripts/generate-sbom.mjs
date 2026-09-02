/**
 * Generates the Software Bill of Materials from the installed dependency tree.
 *
 *   node scripts/generate-sbom.mjs
 *
 * Writes docs/sbom.json (CycloneDX 1.5) and docs/SBOM.md (human-readable table),
 * and exits non-zero if any package carries a licence outside the allow-list.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
// Licences the engagement permits outright.
const ALLOWED = ['MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'Zlib'];
// Copyleft / source-available families the engagement forbids outright.
const FORBIDDEN_MARKERS = ['AGPL', 'LGPL', 'GPL', 'SSPL', 'BUSL', 'Elastic', 'CC-BY-SA', 'MPL', 'EPL', 'CDDL', 'RSAL', 'Commons Clause'];
// Attribution-only licences on non-code assets. Not copyleft, but flagged so the
// client can sign them off explicitly rather than have them pass silently.
const REVIEW = {
  'CC-BY-4.0': 'Attribution-only licence covering a build-time browser-compatibility dataset, not source code. No copyleft obligation; requires attribution only.',
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function normaliseLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(' OR ');
  return 'UNKNOWN';
}

function repoUrl(pkg) {
  const r = pkg.repository;
  const url = typeof r === 'string' ? r : r?.url;
  if (!url) return pkg.homepage || '';
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
}

/** Walks node_modules, including nested and scoped packages. */
function collect(dir, out = new Map()) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name === '.cache') continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('@')) { collect(full, out); continue; }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const pkg = readJson(path.join(full, 'package.json'));
    if (pkg?.name && pkg.version) {
      const key = `${pkg.name}@${pkg.version}`;
      if (!out.has(key)) {
        out.set(key, {
          name: pkg.name,
          version: pkg.version,
          license: normaliseLicense(pkg),
          repository: repoUrl(pkg),
          description: (pkg.description || '').slice(0, 140),
        });
      }
    }
    collect(path.join(full, 'node_modules'), out);
  }
  return out;
}

const manifest = readJson(path.join(root, 'package.json'));
const direct = { ...manifest.dependencies, ...manifest.devDependencies };
const all = [...collect(path.join(root, 'node_modules')).values()]
  .sort((a, b) => a.name.localeCompare(b.name));

function classify(pkg) {
  const l = pkg.license.toUpperCase();
  if (FORBIDDEN_MARKERS.some((m) => l.includes(m.toUpperCase()))) return 'forbidden';
  if (REVIEW[pkg.license]) return 'review';
  // An expression like "(MIT AND Zlib)" passes only if every named licence is allowed.
  const named = pkg.license.split(/\s+(?:AND|OR)\s+|[()]/).map((s) => s.trim()).filter(Boolean);
  if (named.length && named.every((n) => ALLOWED.some((a) => a.toUpperCase() === n.toUpperCase()))) return 'allowed';
  return 'forbidden';
}

const violations = all.filter((p) => classify(p) === 'forbidden');
const needsReview = all.filter((p) => classify(p) === 'review');

const cyclonedx = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ name: 'inkwell-sbom', version: '1.0.0' }],
    component: {
      type: 'application',
      'bom-ref': `${manifest.name}@${manifest.version}`,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
    },
  },
  components: all.map((p) => ({
    type: 'library',
    'bom-ref': `pkg:npm/${p.name}@${p.version}`,
    purl: `pkg:npm/${p.name}@${p.version}`,
    name: p.name,
    version: p.version,
    description: p.description,
    scope: direct[p.name] ? 'required' : 'optional',
    licenses: p.license === 'UNKNOWN' ? [] : [{ license: { id: p.license } }],
    externalReferences: p.repository ? [{ type: 'vcs', url: p.repository }] : [],
  })),
};

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'sbom.json'), `${JSON.stringify(cyclonedx, null, 2)}\n`);

const directRows = all.filter((p) => direct[p.name]);
const transitive = all.filter((p) => !direct[p.name]);
const byLicense = all.reduce((acc, p) => { acc[p.license] = (acc[p.license] || 0) + 1; return acc; }, {});

const row = (p) => `| \`${p.name}\` | ${p.version} | ${p.license} | ${p.repository || '—'} | ${direct[p.name] ? (manifest.devDependencies?.[p.name] ? 'build/test' : 'runtime') : 'transitive'} |`;

const md = `# Software Bill of Materials

Generated ${new Date().toISOString()} by \`npm run sbom\` from the installed dependency tree.
Machine-readable CycloneDX 1.5 output: [\`sbom.json\`](./sbom.json).

**${all.length} packages** — ${directRows.length} declared directly, ${transitive.length} transitive.

## Licence policy

Permitted: ${ALLOWED.map((l) => `\`${l}\``).join(', ')}.

Prohibited without prior written approval: any licence containing
${FORBIDDEN_MARKERS.map((m) => `\`${m}\``).join(', ')}.

Optional packages carrying non-permissive licences are removed automatically after
install by \`scripts/prune-optional.mjs\`; see that file for the rationale.

**Policy check: ${violations.length === 0 ? 'PASS — no copyleft or source-available code is incorporated.' : `FAIL — ${violations.length} package(s) outside the allow-list.`}**

${violations.length ? `### Violations\n\n${violations.map((v) => `- \`${v.name}@${v.version}\` — ${v.license}`).join('\n')}\n` : ''}
${needsReview.length ? `### Flagged for client acknowledgement (${needsReview.length})\n\nNot copyleft, but outside the strict MIT/Apache/BSD list:\n\n${needsReview.map((v) => `- \`${v.name}@${v.version}\` — ${v.license}. ${REVIEW[v.license]}`).join('\n')}\n` : ''}

### Licence distribution

| Licence | Packages |
| --- | ---: |
${Object.entries(byLicense).sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`).join('\n')}

## Direct dependencies

| Package | Version | Licence | Source | Scope |
| --- | --- | --- | --- | --- |
${directRows.map(row).join('\n')}

## Transitive dependencies

| Package | Version | Licence | Source | Scope |
| --- | --- | --- | --- | --- |
${transitive.map(row).join('\n')}

## Provenance statement

This application was written from scratch for this engagement. No code was copied,
forked, translated or adapted from DocuSeal, Documenso, OpenSign, DocuSign or any
other electronic-signature product. The packages listed above are the only external
code incorporated, and each is used as a published library through its public API.
`;

fs.writeFileSync(path.join(root, 'docs', 'SBOM.md'), md);

console.log(`SBOM written: ${all.length} packages (${directRows.length} direct).`);
console.log(Object.entries(byLicense).sort((a, b) => b[1] - a[1]).map(([l, n]) => `  ${String(n).padStart(4)}  ${l}`).join('\n'));
if (needsReview.length) {
  console.log(`\nFlagged for client acknowledgement (${needsReview.length}):`);
  for (const v of needsReview) console.log(`  ${v.name}@${v.version} — ${v.license}`);
}
if (violations.length) {
  console.error(`\nLicence policy violations (${violations.length}):`);
  for (const v of violations) console.error(`  ${v.name}@${v.version} — ${v.license}`);
  process.exit(1);
}
console.log('\nLicence policy: PASS — no copyleft or source-available code incorporated.');
