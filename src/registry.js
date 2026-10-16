// npm registry access and the BFS crawl that builds the dependency graph.
// Follows the `latest` version of every package (no semver range resolution) and ignores
// peer/optional dependencies. Only an Accept header is ever sent, so browsers need no CORS preflight.
import { SpiderError, fetchRetry, mapLimit } from './util.js';

const BASE = 'https://registry.npmjs.org/';
const encodeName = (name) => name.replace('/', '%2F');

export const createCache = () => new Map();

// One small request per package (~4 KB). Cached by name; the cache is shared with bin lookups.
export function fetchLatest(name, { fetch: fetchFn = globalThis.fetch, cache = createCache() } = {}) {
  if (!cache.has(name)) cache.set(name, loadLatest(name, fetchFn));
  return cache.get(name);
}

async function loadLatest(name, fetchFn) {
  const res = await fetchRetry(fetchFn, `${BASE}${encodeName(name)}/latest`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return { name, missing: true, deps: [], peers: [], bins: [], maintainers: 0, deprecated: false, modified: null };
  if (!res.ok) throw new SpiderError('REGISTRY_ERROR', `npm registry answered ${res.status} for ${name}.`);
  const j = await res.json();
  const bin = typeof j.bin === 'string' ? [name.split('/').pop()] : Object.keys(j.bin || {});
  return {
    name, version: j.version, missing: false,
    deps: Object.keys(j.dependencies || {}),
    peers: Object.keys(j.peerDependencies || {}), // not crawled, only used to avoid calling a needed peer a ghost
    bins: bin,
    maintainers: (j.maintainers || []).length,
    deprecated: !!j.deprecated,
    modified: null,
  };
}

// The abbreviated packument has `modified` but can be megabytes (typescript: 8.7 MB), so this is a separate, optional call.
export async function fetchModified(name, { fetch: fetchFn = globalThis.fetch } = {}) {
  try {
    const res = await fetchRetry(fetchFn, `${BASE}${encodeName(name)}`, { headers: { Accept: 'application/vnd.npm.install-v1+json' } });
    if (!res.ok) return null;
    return (await res.json()).modified || null;
  } catch { return null; }
}

// BFS from the manifest's dependencies. Depth 1 = declared by the repo. Returns a graph:
// { nodes: Map(name -> node), roots, capped, errors }. A node's `parent` is whoever discovered it first.
export async function crawl(roots, { fetch: fetchFn, cache = createCache(), maxDepth = 6, maxNodes = 900, concurrency = 8, onNode } = {}) {
  const nodes = new Map();
  const graph = { nodes, roots: [...roots], capped: false, errors: 0 };
  let level = [];
  for (const name of roots) if (!nodes.has(name)) { nodes.set(name, null); level.push({ name, depth: 1, parent: null }); }
  while (level.length) {
    const next = [];
    await mapLimit(level, concurrency, async ({ name, depth, parent }) => {
      let info;
      try { info = await fetchLatest(name, { fetch: fetchFn, cache }); }
      catch { graph.errors++; info = { name, missing: false, failed: true, deps: [], peers: [], bins: [], maintainers: 0, deprecated: false, modified: null }; }
      const node = { ...info, depth, parent };
      nodes.set(name, node);
      for (const dep of node.deps) {
        if (nodes.has(dep) || depth + 1 > maxDepth) continue;
        if (nodes.size >= maxNodes) { graph.capped = true; continue; }
        nodes.set(dep, null); // reserve the slot so it is not queued twice
        next.push({ name: dep, depth: depth + 1, parent: name });
      }
      onNode?.(node, nodes.size);
    });
    level = next;
  }
  for (const [name, n] of nodes) if (!n) nodes.delete(name); // reserved but never fetched (cannot happen unless aborted)
  return graph;
}

// Second, optional pass: fills node.modified in place.
export async function addModified(graph, { fetch: fetchFn, concurrency = 8, onNode } = {}) {
  await mapLimit([...graph.nodes.values()].filter((n) => !n.missing), concurrency, async (n) => {
    n.modified = await fetchModified(n.name, { fetch: fetchFn });
    onNode?.(n);
  });
}

// Heuristic 0..1 "fragility" colour. NOT a security verdict. `modified` is only a proxy for the last publish.
export function fragility(node, now = Date.now()) {
  const staleDays = node.modified ? Math.max(0, (now - Date.parse(node.modified)) / 86400000) : 0;
  return Math.min(1, 0.6 * Math.min(staleDays / 1460, 1) + 0.4 * (node.maintainers === 1 ? 1 : 0) + 0.3 * (node.deprecated ? 1 : 0));
}
