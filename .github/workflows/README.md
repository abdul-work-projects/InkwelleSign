# CI

`ci.yml` runs on every push to `main` and on every pull request:

1. **`npm ci`** — installs strictly from `package-lock.json`. Unlike `npm install`, it
   fails when the lockfile and manifest disagree, and it never silently reuses a local
   `node_modules`. This is what catches a dependency that works on a developer machine
   but is missing from `package.json`.
2. **Manifest check** — asserts the build toolchain actually resolved.
3. **`npm test`** — the automated suite.
4. **`npm run build`** — a full production build.
5. **`npm run sbom`** — regenerates the bill of materials and fails on any copyleft or
   source-available licence entering the dependency tree.

Run the same sequence locally before handing a build over:

```bash
rm -rf node_modules && npm ci && npm test && npm run build && npm run sbom
```
