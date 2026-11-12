#!/usr/bin/env node
/**
 * Writes an SPDX 2.3 JSON SBOM for one shipped build (ESCSUITE-430): the
 * production dependency tree of the workspace package(s) the build is made
 * from, as `pnpm list --prod` resolves it from this checkout's lockfile.
 * Dev dependencies (vite, vitest, eslint…) are not in it.
 *
 * Both release workflows attach the SBOM next to the build and attest it
 * against the build's digest with actions/attest-sbom; docs/VERIFY.md tells
 * users how to check it.
 *
 * Usage:
 *   node scripts/generate-sbom.mjs --build <file> --package <name> [--package <name>…] --output <file>
 *
 *   --build    the shipped file; its name and SHA-256 identify the SBOM's subject
 *   --package  a workspace package the build contains (repeat for a build
 *              made from several, e.g. the headless kit inlines ESCAPEARTIST)
 *   --output   where to write the .spdx.json
 *
 * Env: SOURCE_DATE_EPOCH (creation time, default now), GITHUB_REPOSITORY
 * (default Bonham-Technologies/ESCAPESUITE). Needs `pnpm install` to have run.
 * Tests: scripts/generate-sbom.test.mjs (pnpm test:scripts).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOASSERTION = 'NOASSERTION';
const BUILD_ID = 'SPDXRef-Build';

/** A declared licence if it reads as an SPDX expression, otherwise NOASSERTION. */
export function spdxLicense(license) {
  if (typeof license !== 'string') return NOASSERTION;
  const id = String.raw`(?:LicenseRef-)?[A-Za-z0-9][A-Za-z0-9.+-]*`;
  const expression = new RegExp(String.raw`^\(?${id}(?: (?:AND|OR|WITH) \(?${id}\)?)*\)?$`);
  if (!expression.test(license) || /^(UNLICENSED|SEE )/i.test(license)) return NOASSERTION;
  return license;
}

/** The package URL of an npm package. */
export function purl(name, version) {
  const path = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${path}@${encodeURIComponent(version)}`;
}

function readPackageJson(path) {
  try {
    return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * The SPDX document for one build.
 *
 * @param {object} options
 * @param {string} options.buildName    the shipped file's name
 * @param {string} options.buildSha256  its SHA-256, hex
 * @param {object[]} options.trees      `pnpm list --prod --depth Infinity --json` entries, one per
 *                                      workspace package the build contains
 * @param {string} options.created      ISO 8601 UTC time, no fraction
 * @param {string} options.repo         owner/repo, for the document namespace
 * @param {string} options.tool         e.g. `pnpm-9.15.4`
 * @param {(path: string) => {version?: string, license?: unknown}} [options.readManifest]
 */
export function buildSpdx({ buildName, buildSha256, trees, created, repo, tool, readManifest = readPackageJson }) {
  const packages = new Map(); // name@version -> SPDX package
  const relationships = new Map(); // "from type to" -> relationship
  const usedIds = new Set([BUILD_ID]);

  const relate = (from, type, to) => {
    relationships.set(`${from} ${type} ${to}`, {
      spdxElementId: from,
      relationshipType: type,
      relatedSpdxElement: to,
    });
  };

  const uniqueId = (name, version) => {
    const base = `SPDXRef-npm-${name}-${version}`.replace(/[^A-Za-z0-9.-]/g, '-');
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  /** Adds `node` (and, the first time, its subtree); returns its SPDX id. */
  const visit = (name, node) => {
    // A workspace package shows as `link:../path`; its own package.json has the version.
    const workspace = !node.resolved && /^(link|file):/.test(node.version ?? '');
    const manifest = readManifest(node.path) ?? {};
    const version = workspace || !node.version ? (manifest.version ?? NOASSERTION) : node.version;
    const key = `${name}@${version}`;
    const seen = packages.get(key);
    if (seen) return seen.SPDXID;

    const pkg = {
      name,
      SPDXID: uniqueId(name, version),
      versionInfo: version,
      downloadLocation: node.resolved ?? NOASSERTION,
      filesAnalyzed: false,
      licenseConcluded: NOASSERTION,
      licenseDeclared: spdxLicense(manifest.license),
      copyrightText: NOASSERTION,
      primaryPackagePurpose: 'LIBRARY',
    };
    if (node.resolved) {
      pkg.externalRefs = [
        { referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: purl(name, version) },
      ];
    }
    packages.set(key, pkg);

    for (const [childName, child] of Object.entries(node.dependencies ?? {})) {
      relate(pkg.SPDXID, 'DEPENDS_ON', visit(childName, child));
    }
    return pkg.SPDXID;
  };

  for (const tree of trees) {
    relate(BUILD_ID, 'CONTAINS', visit(tree.name, tree));
  }

  const byName = (a, b) => (a.name === b.name ? (a.versionInfo < b.versionInfo ? -1 : 1) : a.name < b.name ? -1 : 1);
  const build = {
    name: buildName,
    SPDXID: BUILD_ID,
    downloadLocation: NOASSERTION,
    filesAnalyzed: false,
    checksums: [{ algorithm: 'SHA256', checksumValue: buildSha256 }],
    licenseConcluded: NOASSERTION,
    licenseDeclared: NOASSERTION,
    copyrightText: NOASSERTION,
    primaryPackagePurpose: buildName.endsWith('.tgz') ? 'ARCHIVE' : 'APPLICATION',
  };

  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: buildName,
    documentNamespace: `https://github.com/${repo}/sbom/${encodeURIComponent(buildName)}-${buildSha256}`,
    creationInfo: {
      created,
      creators: ['Tool: escapesuite-generate-sbom', `Tool: ${tool}`],
    },
    packages: [build, ...[...packages.values()].sort(byName)],
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: BUILD_ID },
      ...relationships.values(),
    ],
  };
}

/** `pnpm list --prod` for one workspace package, as a single tree. */
function prodTree(packageName) {
  const json = execFileSync(
    'pnpm',
    ['--filter', packageName, 'list', '--prod', '--depth', 'Infinity', '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const trees = JSON.parse(json);
  const tree = trees.find((entry) => entry.name === packageName);
  if (!tree) throw new Error(`pnpm list found no workspace package named ${packageName}`);
  return tree;
}

function parseArgs(argv) {
  const args = { packages: [] };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--build') args.build = value;
    else if (argv[i] === '--output') args.output = value;
    else if (argv[i] === '--package') args.packages.push(value);
    else throw new Error(`unknown argument ${argv[i]}`);
    i++;
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    args = { error };
  }
  if (args.error || !args.build || !args.output || args.packages.length === 0) {
    console.error(
      'usage: generate-sbom.mjs --build <file> --package <name> [--package <name>…] --output <file>'
    );
    process.exit(2);
  }

  const epoch = process.env.SOURCE_DATE_EPOCH;
  const created = (epoch ? new Date(Number(epoch) * 1000) : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const pnpmVersion = execFileSync('pnpm', ['--version'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

  const doc = buildSpdx({
    buildName: basename(args.build),
    buildSha256: createHash('sha256').update(readFileSync(args.build)).digest('hex'),
    trees: args.packages.map(prodTree),
    created,
    repo: process.env.GITHUB_REPOSITORY || 'Bonham-Technologies/ESCAPESUITE',
    tool: `pnpm-${pnpmVersion}`,
  });
  writeFileSync(args.output, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Wrote ${args.output}: ${doc.packages.length - 1} packages for ${doc.name}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
