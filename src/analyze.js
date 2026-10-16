// Classifies declared dependencies as ghost / misplaced / phantom, given the fetched files.
// A package counts as USED if it is imported anywhere OR mentioned in scripts/config.
import { extractImports, BUILTINS } from './extract.js';
import { kindOf } from './github.js';

// package.json keys that are NOT searched for tool mentions. The dependency maps are the
// critical ones: searching them would "mention" every dependency and hide every ghost.
const SKIP_KEYS = new Set([
  'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies',
  'bundleDependencies', 'peerDependenciesMeta', 'dependenciesMeta', 'overrides', 'resolutions', 'pnpm',
  'name', 'version', 'description', 'keywords', 'homepage', 'repository', 'bugs', 'author', 'contributors',
  'maintainers', 'funding', 'license', 'files', 'main', 'module', 'types', 'typings', 'exports', 'bin',
  'engines', 'packageManager', 'private', 'type', 'publishConfig', 'sideEffects', 'browser', 'directories',
  'man', 'os', 'cpu', 'workspaces', 'scripts',
]);

export function mentionText(pkg, configTexts = []) {
  const parts = Object.values(pkg.scripts || {}).filter((v) => typeof v === 'string');
  for (const [k, v] of Object.entries(pkg)) if (!SKIP_KEYS.has(k)) parts.push(JSON.stringify(v));
  parts.push(...configTexts);
  return parts.join('\n').replace(/(?:\.{1,2}\/)*node_modules\/\.bin\//g, '');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The name must not be glued to other name characters: `tap` must not match `tape`.
export function mentions(text, alias) {
  return new RegExp(`(?<![\\w@/.-])${escapeRe(alias)}(?![\\w-]|\\.\\w)`).test(text);
}

// Names tools accept for a package: 'eslint-plugin-react' -> 'react', '@babel/preset-env' -> '@babel/env'.
export function shorthands(name) {
  const out = [];
  const prefixes = ['eslint-plugin-', 'eslint-config-', 'babel-plugin-', 'babel-preset-', 'prettier-plugin-', 'stylelint-config-'];
  if (name.startsWith('@')) {
    const [scope, rest] = name.split('/');
    for (const p of ['eslint-plugin-', 'eslint-config-', 'plugin-', 'preset-']) {
      if (rest.startsWith(p) && rest.length > p.length) out.push(`${scope}/${rest.slice(p.length)}`);
    }
  } else {
    for (const p of prefixes) if (name.startsWith(p) && name.length > p.length) out.push(name.slice(p.length));
  }
  return out;
}

export function aliasesOf(name, bins = []) {
  return [...new Set([name, ...bins, ...shorthands(name)])];
}

// files: [{path, text}]  configTexts: [string]  bins: { pkgName: [binNames] } (from the registry)
export function classify({ pkg, files, configTexts = [], bins = {} }) {
  const kindsByPkg = new Map(); // package -> Set of file kinds importing it
  const filesByPkg = new Map();
  for (const f of files) {
    const kind = kindOf(f.path);
    for (const name of extractImports(f.text)) {
      if (!kindsByPkg.has(name)) { kindsByPkg.set(name, new Set()); filesByPkg.set(name, []); }
      kindsByPkg.get(name).add(kind);
      filesByPkg.get(name).push(f.path);
    }
  }
  const text = mentionText(pkg, [...configTexts, ...files.filter((f) => /^(tooling)$/.test(kindOf(f.path))).map((f) => f.text)]);
  const prod = Object.keys(pkg.dependencies || {});
  const dev = Object.keys(pkg.devDependencies || {});
  const declared = new Set([...prod, ...dev, ...Object.keys(pkg.peerDependencies || {}), ...Object.keys(pkg.optionalDependencies || {}),
    ...(Array.isArray(pkg.bundledDependencies) ? pkg.bundledDependencies : [])]);

  const isMentioned = (name) => aliasesOf(name, bins[name]).some((a) => mentions(text, a));
  const ghosts = [];
  const misplaced = [];
  for (const [section, names] of [['dependencies', prod], ['devDependencies', dev]]) {
    for (const name of names) {
      if (name.startsWith('@types/') || BUILTINS.has(name)) continue; // BUILTINS: ambiguous with node core, skip
      const kinds = kindsByPkg.get(name);
      const mentioned = isMentioned(name);
      if (!kinds && !mentioned) { ghosts.push({ name, section }); continue; }
      if (section === 'dependencies' && !(kinds && kinds.has('src'))) {
        const only = kinds ? [...kinds] : [];
        let reason;
        if (!kinds) reason = 'only mentioned in scripts/config, never imported';
        else if (only.every((k) => k === 'test' || k === 'fixture')) reason = 'only imported from tests';
        else if (only.every((k) => k === 'example')) reason = 'only imported from examples/benchmarks/docs';
        else if (only.every((k) => k === 'tooling')) reason = 'only used in scripts/config';
        else reason = 'only imported from tests, examples or scripts';
        misplaced.push({ name, reason });
      }
    }
  }
  const phantoms = [];
  for (const [name, kinds] of kindsByPkg) {
    if (declared.has(name) || name === pkg.name || name.startsWith('@types/')) continue;
    const real = filesByPkg.get(name).filter((p) => kindOf(p) !== 'fixture');
    if (!real.length) continue;
    phantoms.push({ name, files: real.slice(0, 3) });
  }
  return { ghosts, misplaced, phantoms, importedCount: kindsByPkg.size };
}
