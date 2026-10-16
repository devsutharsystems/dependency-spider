// Turns a pipeline result into plain JSON and back, so the animation can be replayed or performance-tested
// without the network. `Replay` in the app uses the same path.

export function serializeResult(r) {
  const s = r.shed;
  return {
    recordedAt: new Date().toISOString(),
    repo: r.repo, ref: r.ref, counts: r.counts, command: r.command,
    pkg: { dependencies: r.pkg.dependencies || {}, devDependencies: r.pkg.devDependencies || {} },
    manifestNames: r.manifestNames,
    nodes: [...r.graph.nodes.values()].map((n) => ({ name: n.name, depth: n.depth, parent: n.parent, deps: n.deps, peers: n.peers || [], missing: !!n.missing, bins: n.bins, maintainers: n.maintainers, deprecated: n.deprecated, modified: n.modified })),
    ghosts: r.ghosts, peerKept: r.peerKept, misplaced: r.misplaced, phantoms: r.phantoms, evidence: r.evidence,
    capped: r.capped, filesCapped: r.filesCapped, truncatedTree: r.truncatedTree, registryErrors: r.registryErrors,
    shed: { before: s.before, after: s.after, combinedShed: s.combinedShed, percent: s.percent, combinedSet: [...s.combinedSet],
      perGhost: s.perGhost.map((g) => ({ ...g, shedSet: [...g.shedSet] })) },
  };
}

export function deserializeResult(j) {
  const nodes = new Map(j.nodes.map((n) => [n.name, n]));
  return {
    ...j, graph: { nodes, roots: j.manifestNames, capped: j.capped, errors: j.registryErrors },
    shed: { ...j.shed, combinedSet: new Set(j.shed.combinedSet), perGhost: j.shed.perGhost.map((g) => ({ ...g, shedSet: new Set(g.shedSet) })) },
  };
}
