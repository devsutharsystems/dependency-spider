// Orchestration shared by the browser and the Node scripts: URL -> files -> imports -> crawl -> findings -> shed.
import { parseRepoUrl, fetchTree, fetchPackageJson, pickSourceFiles, pickConfigFiles, fetchMany } from './github.js';
import { classify, LOCAL_SPEC } from './analyze.js';
import { crawl, addModified, createCache } from './registry.js';
import { shedReport, uninstallCommand } from './graph.js';
import { SpiderError } from './util.js';

const SOURCE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/;

// onEvent receives progress for the UI: {type:'phase'|'package'|'files'|'imports'|'node'|'modified', ...}
export async function runPipeline(input, { fetch: fetchFn = globalThis.fetch, token, onEvent = () => {}, withModified = false, awaitModified = false, maxFiles = 300 } = {}) {
  const repo = parseRepoUrl(input);
  if (!repo) throw new SpiderError('BAD_URL', 'That does not look like a GitHub repo URL. Try github.com/owner/repo.');

  onEvent({ type: 'phase', phase: 'scan' });
  const tree = await fetchTree(repo, { fetch: fetchFn, token });
  const pkg = await fetchPackageJson(repo, { fetch: fetchFn, ref: tree.ref });
  onEvent({ type: 'package', pkg });
  if (pkg.workspaces) throw new SpiderError('MONOREPO', 'This repo declares `workspaces` (a monorepo). Dependency Spider only analyses a single root package.json.');
  const prod = Object.keys(pkg.dependencies || {});
  const dev = Object.keys(pkg.devDependencies || {});
  const allSpecs = { ...pkg.devDependencies, ...pkg.dependencies };
  const manifestNames = [...new Set([...prod, ...dev])].filter((n) => !LOCAL_SPEC.test(allSpecs[n])); // local paths are not on npm
  if (!manifestNames.length) throw new SpiderError('NO_DEPS', 'This package.json declares no dependencies or devDependencies, nothing to scan.');

  const sourcePaths = pickSourceFiles(tree.paths, maxFiles);
  const eligibleSourceFiles = pickSourceFiles(tree.paths, Infinity).length;
  const configPaths = pickConfigFiles(tree.paths).filter((p) => !sourcePaths.includes(p));
  const wanted = [...sourcePaths, ...configPaths];
  const { texts, failed } = await fetchMany(wanted, { ...repo, ref: tree.ref, fetch: fetchFn, onProgress: (done, total) => onEvent({ type: 'files', done, total }) });

  const files = [];
  const configTexts = [];
  for (const p of sourcePaths) if (texts.get(p) != null) files.push({ path: p, text: texts.get(p) });
  let extensionless = 0;
  for (const p of configPaths) {
    const t = texts.get(p);
    if (t == null) continue;
    const base = p.split('/').pop();
    if (!base.includes('.') && !p.startsWith('.husky/')) {
      if (t.startsWith('#!')) { files.push({ path: p, text: t }); extensionless++; configTexts.push(t); } // only real scripts, e.g. bin/hexo
    } else if (SOURCE_EXT.test(p)) files.push({ path: p, text: t });
    else configTexts.push(t);
  }
  const nestedRoots = tree.paths.filter((p) => /\/package\.json$/.test(p) && !p.includes('node_modules/')).map((p) => p.slice(0, -'package.json'.length));
  const prelim = classify({ pkg, files, configTexts });
  onEvent({ type: 'imports', count: prelim.importedCount });

  onEvent({ type: 'phase', phase: 'crawl' });
  const cache = createCache();
  const graph = await crawl(manifestNames, { fetch: fetchFn, cache, onNode: (node, count) => onEvent({ type: 'node', node, count }) });
  if (graph.errors > graph.nodes.size / 2) throw new SpiderError('REGISTRY_DOWN', 'The npm registry kept failing, so the tree could not be built. Try again in a minute.');

  const bins = Object.fromEntries([...graph.nodes].map(([n, node]) => [n, node.bins]));
  const findings = classify({ pkg, files, configTexts, bins, nestedRoots });
  // A "ghost" that another package needs as a peer dependency (e.g. typescript for tstyche) is not a ghost.
  const peerKept = [];
  const ghosts = findings.ghosts.filter((g) => {
    const owner = [...graph.nodes.values()].sort((a, b) => a.depth - b.depth).find((n) => n.peers?.includes(g.name));
    if (owner) { peerKept.push({ ...g, neededBy: owner.name }); findings.evidence[g.name] = `peer dependency of ${owner.name}`; }
    return !owner;
  });
  const shed = shedReport(graph, manifestNames, ghosts);
  const result = {
    repo, ref: tree.ref, pkg, manifestNames, truncatedTree: tree.truncated,
    counts: { declared: manifestNames.length, prod: prod.length, dev: dev.length, sourceFiles: sourcePaths.length, eligibleSourceFiles, configFiles: configPaths.length, extensionless, fetched: files.length + configTexts.length, failedFiles: failed.length, importedPackages: findings.importedCount },
    graph, ghosts, peerKept, evidence: findings.evidence, misplaced: findings.misplaced, phantoms: findings.phantoms, shed, command: uninstallCommand(ghosts),
    capped: graph.capped, filesCapped: eligibleSourceFiles > sourcePaths.length, registryErrors: graph.errors,
  };
  if (withModified) {
    const p = addModified(graph, { fetch: fetchFn, onNode: (n) => onEvent({ type: 'modified', node: n }) });
    result.modifiedPromise = p;
    if (awaitModified) await p;
  }
  return result;
}
