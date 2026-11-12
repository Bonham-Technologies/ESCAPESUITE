/**
 * Tests for scripts/generate-sbom.mjs (ESCSUITE-430): the SPDX 2.3 SBOM both
 * release workflows attach to every build and attest with actions/attest-sbom.
 *
 * The first tests feed buildSpdx() a fixture dependency tree. The last ones
 * run the CLI against this workspace's real lockfile and node_modules (CI runs
 * `pnpm test:scripts` after `pnpm install`), so they prove the SBOM lists a
 * build's production dependencies and none of its dev dependencies.
 *
 * Node's built-in runner, no dependencies:
 *
 *   pnpm test:scripts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';

import { buildSpdx, purl, spdxLicense } from './generate-sbom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'generate-sbom.mjs');

const CREATED = '2026-11-12T10:00:00Z';
const SHA = 'a'.repeat(64);

/** A pnpm `list --prod --json` entry for @escapesuite/craft, trimmed. */
const CRAFT_TREE = {
  name: '@escapesuite/craft',
  version: '2.19.0',
  path: '/repo/apps/craft',
  private: true,
  dependencies: {
    react: {
      from: 'react',
      version: '19.3.1',
      resolved: 'https://registry.npmjs.org/react/-/react-19.3.1.tgz',
      path: '/repo/node_modules/.pnpm/react@19.3.1/node_modules/react',
    },
    '@vercel/analytics': {
      from: '@vercel/analytics',
      version: '2.0.1',
      resolved: 'https://registry.npmjs.org/@vercel/analytics/-/analytics-2.0.1.tgz',
      path: '/repo/node_modules/.pnpm/@vercel+analytics@2.0.1/node_modules/@vercel/analytics',
      dependencies: {
        react: {
          from: 'react',
          version: '19.3.1',
          resolved: 'https://registry.npmjs.org/react/-/react-19.3.1.tgz',
          path: '/repo/node_modules/.pnpm/react@19.3.1/node_modules/react',
        },
      },
    },
    '@escapesuite/shared': {
      from: '@escapesuite/shared',
      version: 'link:../../packages/shared',
      path: '/repo/packages/shared',
      dependencies: {
        idb: {
          from: 'idb',
          version: '8.0.4',
          resolved: 'https://registry.npmjs.org/idb/-/idb-8.0.4.tgz',
          path: '/repo/node_modules/.pnpm/idb@8.0.4/node_modules/idb',
        },
      },
    },
  },
};

const MANIFESTS = {
  '/repo/apps/craft': { version: '2.19.0', license: 'MIT' },
  '/repo/packages/shared': { version: '1.4.3', license: 'MIT' },
  '/repo/node_modules/.pnpm/react@19.3.1/node_modules/react': { license: 'MIT' },
  '/repo/node_modules/.pnpm/@vercel+analytics@2.0.1/node_modules/@vercel/analytics': {
    license: 'MPL-2.0',
  },
  '/repo/node_modules/.pnpm/idb@8.0.4/node_modules/idb': { license: 'ISC' },
};

function craftSbom() {
  return buildSpdx({
    buildName: 'ESCAPECRAFT-2.19.0.html',
    buildSha256: SHA,
    trees: [CRAFT_TREE],
    created: CREATED,
    repo: 'Bonham-Technologies/ESCAPESUITE',
    tool: 'pnpm-9.15.4',
    readManifest: (path) => MANIFESTS[path] ?? {},
  });
}

const byName = (doc, name) => doc.packages.filter((pkg) => pkg.name === name);

test('writes an SPDX 2.3 document that describes the build by name and SHA-256', () => {
  const doc = craftSbom();
  assert.equal(doc.spdxVersion, 'SPDX-2.3');
  assert.equal(doc.dataLicense, 'CC0-1.0');
  assert.equal(doc.SPDXID, 'SPDXRef-DOCUMENT');
  assert.equal(doc.name, 'ESCAPECRAFT-2.19.0.html');
  // SPDX wants a namespace unique to each document: the same build can be on
  // two releases, each with its own SBOM.
  assert.match(
    doc.documentNamespace,
    /^https:\/\/github\.com\/Bonham-Technologies\/ESCAPESUITE\/sbom\/ESCAPECRAFT-2\.19\.0\.html-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );
  assert.notEqual(craftSbom().documentNamespace, doc.documentNamespace, 'each SBOM gets its own namespace');
  assert.equal(doc.creationInfo.created, CREATED);
  assert.ok(doc.creationInfo.creators.includes('Tool: pnpm-9.15.4'));

  const [build] = byName(doc, 'ESCAPECRAFT-2.19.0.html');
  assert.equal(build.SPDXID, 'SPDXRef-Build');
  assert.deepEqual(build.checksums, [{ algorithm: 'SHA256', checksumValue: SHA }]);
  assert.equal(build.filesAnalyzed, false);
  assert.ok(
    doc.relationships.some(
      (rel) =>
        rel.spdxElementId === 'SPDXRef-DOCUMENT' &&
        rel.relationshipType === 'DESCRIBES' &&
        rel.relatedSpdxElement === 'SPDXRef-Build'
    )
  );
});

test('lists each package once, with its version, purl, download location and licence', () => {
  const doc = craftSbom();
  const [react] = byName(doc, 'react');
  assert.equal(byName(doc, 'react').length, 1, 'react appears twice in the tree but once in the SBOM');
  assert.equal(react.versionInfo, '19.3.1');
  assert.equal(react.downloadLocation, 'https://registry.npmjs.org/react/-/react-19.3.1.tgz');
  assert.equal(react.licenseDeclared, 'MIT');
  assert.deepEqual(react.externalRefs, [
    { referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: 'pkg:npm/react@19.3.1' },
  ]);

  const [analytics] = byName(doc, '@vercel/analytics');
  assert.equal(analytics.externalRefs[0].referenceLocator, 'pkg:npm/%40vercel/analytics@2.0.1');
  assert.equal(analytics.licenseDeclared, 'MPL-2.0');

  // Every SPDX id is unique and well-formed.
  const ids = doc.packages.map((pkg) => pkg.SPDXID);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^SPDXRef-[A-Za-z0-9.-]+$/);
});

test('names workspace packages by their own version, with no purl, and the build contains them', () => {
  const doc = craftSbom();
  const [shared] = byName(doc, '@escapesuite/shared');
  assert.equal(shared.versionInfo, '1.4.3');
  assert.equal(shared.downloadLocation, 'NOASSERTION');
  assert.equal(shared.externalRefs, undefined);

  const [craft] = byName(doc, '@escapesuite/craft');
  const [idb] = byName(doc, 'idb');
  const has = (from, type, to) =>
    doc.relationships.some(
      (rel) => rel.spdxElementId === from && rel.relationshipType === type && rel.relatedSpdxElement === to
    );
  assert.ok(has('SPDXRef-Build', 'CONTAINS', craft.SPDXID));
  assert.ok(has(craft.SPDXID, 'DEPENDS_ON', shared.SPDXID));
  assert.ok(has(shared.SPDXID, 'DEPENDS_ON', idb.SPDXID));

  // Every relationship points at a package in the document.
  const ids = new Set(['SPDXRef-DOCUMENT', ...doc.packages.map((pkg) => pkg.SPDXID)]);
  for (const rel of doc.relationships) {
    assert.ok(ids.has(rel.spdxElementId) && ids.has(rel.relatedSpdxElement), JSON.stringify(rel));
  }
});

test('walks optionalDependencies at every level, as optional dependencies', () => {
  const tree = {
    name: '@escapesuite/headless-artist',
    version: '1.0.0',
    path: '/repo/services/headless-artist',
    dependencies: {
      playwright: {
        version: '1.65.0',
        resolved: 'https://registry.npmjs.org/playwright/-/playwright-1.65.0.tgz',
        path: '/pw',
        optionalDependencies: {
          fsevents: { version: '2.3.2', resolved: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz', path: '/fse' },
        },
      },
    },
    optionalDependencies: {
      '@aws-sdk/client-s3': {
        version: '3.1164.0',
        resolved: 'https://registry.npmjs.org/@aws-sdk/client-s3/-/client-s3-3.1164.0.tgz',
        path: '/s3',
        dependencies: {
          tslib: { version: '2.8.1', resolved: 'https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz', path: '/tslib' },
        },
      },
    },
  };
  const doc = buildSpdx({
    buildName: 'escapesuite-headless-artist-1.0.0.tgz',
    buildSha256: SHA,
    trees: [tree],
    created: CREATED,
    repo: 'Bonham-Technologies/ESCAPESUITE',
    tool: 'pnpm-9.15.4',
    readManifest: () => ({}),
  });
  const id = (name) => byName(doc, name)[0]?.SPDXID;
  for (const name of ['@aws-sdk/client-s3', 'tslib', 'fsevents']) assert.ok(id(name), `expected ${name}`);
  const has = (from, type, to) =>
    doc.relationships.some(
      (rel) => rel.spdxElementId === from && rel.relationshipType === type && rel.relatedSpdxElement === to
    );
  assert.ok(has(id('@aws-sdk/client-s3'), 'OPTIONAL_DEPENDENCY_OF', id('@escapesuite/headless-artist')));
  assert.ok(has(id('fsevents'), 'OPTIONAL_DEPENDENCY_OF', id('playwright')));
  assert.ok(has(id('@aws-sdk/client-s3'), 'DEPENDS_ON', id('tslib')));
});

test('falls back to NOASSERTION for a licence that is not an SPDX expression', () => {
  assert.equal(spdxLicense('MIT'), 'MIT');
  assert.equal(spdxLicense('(MIT OR Apache-2.0)'), '(MIT OR Apache-2.0)');
  assert.equal(spdxLicense('Apache-2.0 WITH LLVM-exception'), 'Apache-2.0 WITH LLVM-exception');
  assert.equal(spdxLicense('SEE LICENSE IN LICENSE.md'), 'NOASSERTION');
  assert.equal(spdxLicense('UNLICENSED'), 'NOASSERTION');
  assert.equal(spdxLicense(undefined), 'NOASSERTION');
  assert.equal(spdxLicense({ type: 'MIT' }), 'NOASSERTION');
});

test('encodes a scoped name in its purl', () => {
  assert.equal(purl('@types/react', '19.3.0'), 'pkg:npm/%40types/react@19.3.0');
  assert.equal(purl('zustand', '5.1.0'), 'pkg:npm/zustand@5.1.0');
});

let work;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'generate-sbom-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Runs the CLI against this workspace for a fake build file. */
function generate(buildName, packages) {
  const build = join(work, buildName);
  writeFileSync(build, `<html>${buildName}</html>`);
  const output = join(work, 'out.spdx.json');
  const result = spawnSync(
    'node',
    [script, '--build', build, ...packages.flatMap((name) => ['--package', name]), '--output', output],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1794477600' } }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    doc: JSON.parse(readFileSync(output, 'utf8')),
    sha: createHash('sha256').update(readFileSync(build)).digest('hex'),
  };
}

test('the ESCAPECRAFT SBOM lists its production dependencies and no dev dependency', () => {
  const { doc, sha } = generate('ESCAPECRAFT-0.0.0.html', ['@escapesuite/craft']);
  const names = new Set(doc.packages.map((pkg) => pkg.name));
  for (const name of ['@escapesuite/craft', '@escapesuite/shared', 'react', 'react-dom', 'mediabunny', 'zustand']) {
    assert.ok(names.has(name), `expected ${name} in the ESCAPECRAFT SBOM`);
  }
  for (const name of ['vitest', 'vite', 'eslint', 'typescript', 'jsdom', '@playwright/test', 'playwright']) {
    assert.ok(!names.has(name), `${name} is a dev dependency and must not be in the SBOM`);
  }
  assert.equal(byName(doc, 'ESCAPECRAFT-0.0.0.html')[0].checksums[0].checksumValue, sha);
  assert.equal(doc.creationInfo.created, '2026-11-12T10:00:00Z', 'SOURCE_DATE_EPOCH sets the creation time');
});

test('the headless kit SBOM lists the CLI and the inlined ESCAPEARTIST tree', () => {
  const { doc } = generate('escapesuite-headless-artist-0.0.0.tgz', [
    '@escapesuite/headless-artist',
    '@escapesuite/artist',
  ]);
  const names = new Set(doc.packages.map((pkg) => pkg.name));
  for (const name of ['@escapesuite/headless-artist', '@escapesuite/artist', 'playwright', 'mediabunny', 'mp4box']) {
    assert.ok(names.has(name), `expected ${name} in the kit SBOM`);
  }
  // An optional dependency: a plain `npm install` of the kit pulls it in, and
  // pnpm lists it under optionalDependencies, not dependencies.
  assert.ok(names.has('@aws-sdk/client-s3'), 'expected the optional @aws-sdk/client-s3 in the kit SBOM');
  const [s3] = byName(doc, '@aws-sdk/client-s3');
  const [cli] = byName(doc, '@escapesuite/headless-artist');
  assert.ok(
    doc.relationships.some(
      (rel) =>
        rel.spdxElementId === s3.SPDXID &&
        rel.relationshipType === 'OPTIONAL_DEPENDENCY_OF' &&
        rel.relatedSpdxElement === cli.SPDXID
    ),
    '@aws-sdk/client-s3 is an optional dependency of the CLI'
  );
  // ...and its own tree comes with it.
  assert.ok(
    doc.relationships.some((rel) => rel.spdxElementId === s3.SPDXID && rel.relationshipType === 'DEPENDS_ON'),
    'expected @aws-sdk/client-s3 to list its own dependencies'
  );
  for (const name of ['vitest', 'esbuild', 'tsx', 'typescript']) {
    assert.ok(!names.has(name), `${name} is a dev dependency and must not be in the SBOM`);
  }
});

test('rejects a call without a build, a package and an output', () => {
  const result = spawnSync('node', [script, '--package', '@escapesuite/craft'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage/);
});
