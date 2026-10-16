# Note: are debug's karma packages used by name?

Date: 2026-10-16. Read-only check, **tests were not run**. Throwaway clone of `debug-js/debug` (commit `666dbc50680933bde9e7fde3a6c3241102e8f60b`), outside this project.

Command: `git grep -n "frameworks\|browsers\|plugins" -- karma.conf.js`

```
karma.conf.js:4:		// available frameworks: https://npmjs.org/browse/keyword/karma-adapter
karma.conf.js:5:		frameworks: ['browserify', 'mocha'],
karma.conf.js:29:		// Start these browsers
karma.conf.js:31:		browsers: ['HeadlessChrome'],
karma.conf.js:50:		// if true, Karma captures browsers, runs the tests and exits
```

There is no `plugins:` entry, so Karma's default applies: it auto-loads every installed `karma-*` package. `package.json` runs it with `"test:browser": "karma start --single-run"`. The rest of `karma.conf.js` (read in full) adds `preprocessors: {...: ['browserify']}`, `browserify: { transform: ['brfs'] }` and `customLaunchers.HeadlessChrome.base: 'ChromeHeadless'`.

| Candidate | Used by name? | Evidence |
|---|---|---|
| `karma-mocha` | Yes | `frameworks: [..., 'mocha']`: the `mocha` framework is provided by this plugin |
| `karma-browserify` | Yes | `frameworks: ['browserify', ...]` and `preprocessors: [...]: ['browserify']` |
| `karma-chrome-launcher` | Very probably | `base: 'ChromeHeadless'` is a launcher name that this package provides; the package name never appears in the file. This step relies on how Karma plugins are known to work, not on anything I ran |

So all three are very probably false positives of the scanner, matching depcheck-with-install, which does not flag `karma-browserify` or `karma-mocha`. Not confirmed by a removal test. The "lower confidence: likely loaded by karma" badge fires on all three.
