# DECISIONS
- Stage 0: git top-level is this folder already; no parent repo problem. No `git init` needed.
- GitHub trees API verified here: `HEAD` accepted (200), shape {sha,url,tree,truncated}, CORS *, 404 for missing repo, limit 60/h. HEAD-then-default_branch fallback is still implemented.
- `modified` costs a lot: abbreviated packuments measured at 29 KB (ms), 780 KB (fastify), 1.2 MB (eslint), 8.7 MB (typescript), versus 2-7 KB for `/<name>/latest`. So the crawl builds the tree from `/latest` only, and `modified` is fetched in a separate optional second pass (`withModified`), so the tree/animation never waits for it. Missing `modified` contributes 0 staleness to fragility.
- Node 24 rejects `node --test test/`; the test command is `node --test test/*.test.mjs` (`npm test`).
- Crawl is level-synchronous BFS (8 parallel within a level): simpler than a worker pool, deterministic levels.
- Packages whose name is also a Node built-in (e.g. `events`, `buffer`) are never reported as ghosts: `require('events')` resolves to core, so we cannot tell.
