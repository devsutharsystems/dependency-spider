# depcheck with installed dependencies (3 repos)

Each clone got `npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps`, then `npx depcheck --json` again. `@types/*` excluded. Compare with the no-install baseline in validation.md.

| Repo | Install (s) | depcheck, no install | depcheck, installed | My candidates | Both (installed) | Only mine now | Only depcheck now |
|---|---|---|---|---|---|---|---|
| postcss/postcss | 30 | 9 | 4 | 3 | 3 | 0 (-) | 1 (`ts-node`) |
| expressjs/express | 5 | 4 | 1 | 1 | 1 | 0 (-) | 0 (-) |
| debug-js/debug | 57 | 10 | 3 | 4 | 2 | 2 (`karma-browserify`, `karma-mocha`) | 1 (`brfs`) |

Totals: depcheck flags 23 without install and 8 with install; mine 8; in both (installed) 6.
