// Graph math on the crawled graph: reachability, what removing ghosts sheds, the uninstall command.

// All packages reachable from the given manifest entries.
export function reachable(graph, manifestNames) {
  const seen = new Set();
  const stack = manifestNames.filter((n) => graph.nodes.has(n));
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const dep of graph.nodes.get(name).deps) if (graph.nodes.has(dep) && !seen.has(dep)) stack.push(dep);
  }
  return seen;
}

// ghosts: [{name, section}]. For each ghost: how many packages disappear if only that manifest
// entry is removed, or which package still needs it. Plus the overlap-aware combined shed.
export function shedReport(graph, manifestNames, ghosts) {
  const before = reachable(graph, manifestNames);
  const ghostNames = new Set(ghosts.map((g) => g.name));
  const perGhost = ghosts.map((g) => {
    const after = reachable(graph, manifestNames.filter((n) => n !== g.name));
    const shedSet = new Set([...before].filter((n) => !after.has(n)));
    let stillNeededBy = null;
    if (!shedSet.has(g.name)) {
      const parents = [...after].filter((p) => graph.nodes.get(p).deps.includes(g.name));
      parents.sort((a, b) => graph.nodes.get(a).depth - graph.nodes.get(b).depth || (a < b ? -1 : 1));
      stillNeededBy = parents[0] ?? null;
    }
    return { ...g, shed: shedSet.size, shedSet, stillNeededBy };
  });
  const afterAll = reachable(graph, manifestNames.filter((n) => !ghostNames.has(n)));
  const combinedSet = new Set([...before].filter((n) => !afterAll.has(n)));
  return {
    before: before.size,
    after: afterAll.size,
    combinedShed: combinedSet.size,
    combinedSet,
    percent: before.size ? Math.round((combinedSet.size / before.size) * 100) : 0,
    perGhost,
  };
}

// `npm uninstall` for prod ghosts and `npm uninstall -D` for dev ghosts (empty string if none).
export function uninstallCommand(ghosts) {
  const prod = ghosts.filter((g) => g.section === 'dependencies').map((g) => g.name);
  const dev = ghosts.filter((g) => g.section === 'devDependencies').map((g) => g.name);
  return [prod.length && `npm uninstall ${prod.join(' ')}`, dev.length && `npm uninstall -D ${dev.join(' ')}`].filter(Boolean).join('\n');
}
