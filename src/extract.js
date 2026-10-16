// Pulls npm package names out of JS/TS source text with regexes. No network, no DOM.
// Regex, not a parser: dynamic requires (require(variable)) are invisible to it.

// Node built-ins. `test`, `sea` and `sqlite` are deliberately absent: they only
// resolve as built-ins with a `node:` prefix, otherwise they are npm packages.
export const BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const NPM_NAME = /^(?:@[A-Za-z0-9~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/;

// 'lodash/fp' -> 'lodash', '@scope/pkg/sub' -> '@scope/pkg'; null when it is not an npm package.
export function toPackageName(spec) {
  if (typeof spec !== 'string' || !spec) return null;
  if (/^[./#~]/.test(spec) || spec.startsWith('@/')) return null; // relative, absolute, subpath import, aliases
  if (spec.includes(':') || spec.includes('${') || spec.includes('`')) return null; // node:, https:, templates
  const parts = spec.split('/');
  let name;
  if (spec.startsWith('@')) {
    if (parts.length < 2 || !parts[1]) return null;
    name = `${parts[0]}/${parts[1]}`;
  } else {
    name = parts[0];
    if (BUILTINS.has(name)) return null;
  }
  return NPM_NAME.test(name) ? name : null;
}

const PATTERNS = [
  /\bfrom\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
  /\brequire(?:\.resolve)?\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g,
];

// Only whole-line `//` comments are removed. Block comments are NOT stripped: globs like
// 'lib/*.js' contain `/*` and would swallow real imports. Over-counting usage hides a ghost;
// under-counting would invent one, so we prefer the safe direction.
export function stripLineComments(text) {
  return text.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
}

// Returns the sorted unique npm package names imported by `text`.
export function extractImports(text) {
  const clean = stripLineComments(text);
  const names = new Set();
  for (const re of PATTERNS) {
    for (const m of clean.matchAll(re)) {
      const name = toPackageName(m[2]);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}
