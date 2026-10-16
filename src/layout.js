// Fixed radial tree layout: ring = depth, angular sector proportional to subtree size.
// Deliberately NOT a force simulation (it exploded with 400+ nodes). Pure function, no DOM.

// nodes: Map(name -> {depth, parent}) in discovery order (parents before children).
// Returns Map(name -> {angle, ring}) with angle in radians and ring = depth (1..maxDepth).
export function layoutRadial(nodes, { startAngle = -Math.PI / 2 } = {}) {
  const children = new Map();
  const roots = [];
  for (const [name, n] of nodes) {
    if (n.parent && nodes.has(n.parent)) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(name);
    } else roots.push(name);
  }
  const size = new Map();
  for (const name of [...nodes.keys()].reverse()) {
    size.set(name, 1 + (children.get(name) || []).reduce((s, c) => s + size.get(c), 0));
  }
  const out = new Map();
  const place = (names, a0, a1) => {
    const total = names.reduce((s, n) => s + size.get(n), 0);
    let a = a0;
    for (const name of names) {
      const span = ((a1 - a0) * size.get(name)) / total;
      out.set(name, { angle: a + span / 2, ring: nodes.get(name).depth });
      place(children.get(name) || [], a, a + span);
      a += span;
    }
  };
  if (roots.length) place(roots, startAngle, startAngle + Math.PI * 2);
  return out;
}
