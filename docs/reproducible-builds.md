# Reproducible builds

**Audience:** someone who wants to check that the PWA or Chromium extension they run is the same bytes this repo produces.  
**Date:** 2026-08-20  
**Not claimed:** bit-identical output across operating systems, CPU architectures, or Node majors. The check is: two clean builds on the **same** toolchain match.

The server is a blob store. The bytes you execute are the PWA (`frontend/dist`) and the MV3 extension (`extension/dist`). Those are what this document hashes.

---

## What is hashed

`scripts/hash-dist.mjs` walks a dist directory, skips `.DS_Store`, sorts POSIX-relative paths, SHA-256s each file, then SHA-256s the manifest:

```
<file-sha256>  <relative/path>
...
```

The last line printed as `tree <sha256>` is the tree hash. Empty directories do not count.

Sourcemaps are not emitted (`vite` `build.sourcemap: false`, esbuild `sourcemap: false`).

---

## How to reproduce

Node 22, lockfile install, UTC, fixed epoch:

```sh
npm ci
export SOURCE_DATE_EPOCH=0 TZ=UTC LC_ALL=C

npm run build                 # frontend/dist
npm run build:extension       # extension/dist/chromium + dist/firefox

node scripts/hash-dist.mjs frontend/dist
node scripts/hash-dist.mjs extension/dist
```

Two builds on the same machine must match:

```sh
npm run verify:reproducible
```

That script builds each target twice into temp dirs and compares tree hashes. CI runs it on Ubuntu + Node 22 (`SOURCE_DATE_EPOCH=0`).

---

## What this is not

- Not a Debian/Nix “rebuild the world” attestation. macOS vs Linux can still diverge (optional native deps, line endings, esbuild binary).
- Not a signed release process. There is no published golden hash in git — it would churn on every source change. Publish the tree hash **next to** a release artifact if you ship one.
- Not a proof that the **server** you self-host is unmodified. Hash the static client; treat the API as untrusted (`docs/security-boundary.md`).
- The TypeScript `tsc -b` step of `npm run build` does not enter the tree hash. Only `vite` output and the extension `dist/` do.

---

## Tooling pins

| Input | Pin |
|---|---|
| JS deps | `package-lock.json` via `npm ci` |
| Node | 22 (CI `actions/setup-node`) |
| Epoch | `SOURCE_DATE_EPOCH=0` |
| Locale | `TZ=UTC` `LC_ALL=C` |
| Extension bundler | esbuild, `legalComments: none` |
| PWA bundler | Vite, no sourcemaps |

If `verify:reproducible` fails, the build is not deterministic on that toolchain. Do not publish a tree hash until it passes.