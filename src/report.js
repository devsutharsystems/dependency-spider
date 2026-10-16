// Turns a pipeline result into text: a plain report and the PR description.

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function ghostLine(g) {
  const base = ghostLineBase(g);
  return g.likelyLoadedBy ? `${base} (lower confidence: likely loaded by ${g.likelyLoadedBy} by name)` : base;
}

function ghostLineBase(g) {
  return g.stillNeededBy
    ? `${g.name}: still needed by ${g.stillNeededBy}, removing it will not shrink the tree`
    : `${g.name}: sheds ${plural(g.shed, 'package')}`;
}

export function plainReport(r) {
  const s = r.shed;
  const lines = [
    `${r.repo.owner}/${r.repo.repo}  (ref ${r.ref})`,
    `declared: ${r.counts.declared} (${r.counts.prod} prod, ${r.counts.dev} dev) | files fetched: ${r.counts.fetched} (${r.counts.sourceFiles} source, ${r.counts.configFiles} config) | packages imported: ${r.counts.importedPackages}`,
    ...(r.filesCapped ? [`WARNING: file cap reached, scanned ${r.counts.sourceFiles} of ${r.counts.eligibleSourceFiles} source files (tests last). Candidates may include false ghosts.`] : []),
    `dependency tree: ${s.before} packages${r.capped ? ' (cap reached, tree is partial)' : ''}`,
    '',
    `Unused candidates (verify before removing): ${r.ghosts.length}`,
    ...s.perGhost.map((g) => `  - ${ghostLine(g)}`),
    '',
    r.ghosts.length ? `Removing all candidates: -${s.combinedShed} packages, ${s.before} -> ${s.after} (${s.percent}% smaller)` : 'No unused candidates found.',
    r.command,
  ];
  if (r.peerKept?.length) lines.push('', 'Not reported (needed as a peer dependency):', ...r.peerKept.map((k) => `  - ${k.name}: peer of ${k.neededBy}`));
  if (r.misplaced.length) lines.push('', 'Misplaced:', ...r.misplaced.map((m) => `  - ${m.name}: ${m.reason}`));
  if (r.phantoms.length) lines.push('', 'Phantom (imported, not declared):', ...r.phantoms.map((p) => `  - ${p.name} (${p.files.join(', ')})`));
  return lines.join('\n');
}

export function prText(r) {
  const s = r.shed;
  return [
    `## Remove unused dependencies (candidates)`,
    '',
    `A static scan of \`${r.repo.owner}/${r.repo.repo}\` found ${r.ghosts.length} ${r.ghosts.length === 1 ? 'dependency' : 'dependencies'} that the code never imports and no script or config mentions.`,
    '',
    ...s.perGhost.map((g) => `- \`${g.name}\` (${g.section}): ${g.stillNeededBy ? `still needed by \`${g.stillNeededBy}\`, so removing it will not shrink the tree` : `removing it sheds ${plural(g.shed, 'package')} from the tree`}`),
    '',
    `Removing all of them together: **-${s.combinedShed} packages** (${s.before} -> ${s.after}, ${s.percent}% smaller), measured by following the \`latest\` version of each package on npm.`,
    '',
    '```sh',
    r.command,
    '```',
    '',
    '**These are candidates, not verdicts.** The scan is regex based and cannot see dynamic requires or config-only usage. Re-run your tests (and your build) before merging.',
  ].join('\n');
}
