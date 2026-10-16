# Validation against depcheck

Generated 2026-10-16 by `scripts/validate.mjs`. depcheck was run with `npx depcheck --json` in a shallow clone WITHOUT installing the repo's dependencies (so depcheck cannot see installed bins); `@types/*` is excluded from its list because my scanner never reports them.
Neither tool is ground truth. "Disagreement" means the two lists differ; the reason column is evidence, not a verdict.

| Repo | Declared | Files scanned | My candidates | depcheck unused | Agree | Only mine | Only depcheck | Shed (pkgs) |
|---|---|---|---|---|---|---|---|---|
| fastify/fastify | 50 | 282/282 | 2 | 10 | 2 | 0 | 8 | 1 of 464 |
| expressjs/express | 44 | 141/141 | 1 | 4 | 1 | 0 | 3 | 9 of 297 |
| koajs/koa | 23 | 82/82 | 0 | 4 | 0 | 0 | 4 | 0 of 327 |
| hexojs/hexo | 47 | 274/274 | 0 | 7 | 0 | 0 | 7 | 0 of 524 |
| mochajs/mocha | 53 | 300/478 (cap) | 1 | 12 | 1 | 0 | 11 | 2 of 585 |
| postcss/postcss | 21 | 63/63 | 2 | 9 | 2 | 0 | 7 | 23 of 228 |
| axios/axios | 42 | 278/278 | 1 | 12 | 1 | 0 | 11 | 0 of 540 |
| chalk/chalk | 11 | 13/13 | 1 | 5 | 1 | 0 | 4 | 1 of 481 |
| tj/commander.js | 9 | 170/170 | 0 | 2 | 0 | 0 | 2 | 0 of 181 |
| winstonjs/winston | 29 | 82/82 | 1 | 5 | 1 | 0 | 4 | 3 of 518 |
| jprichardson/node-fs-extra | 11 | 112/112 | 0 | 2 | 0 | 0 | 2 | 0 of 326 |
| debug-js/debug | 12 | 7/7 | 4 | 10 | 4 | 0 | 6 | 7 of 682 |
| expressjs/body-parser | 14 | 14/14 | 0 | 2 | 0 | 0 | 2 | 0 of 274 |

Totals over 13 repos that ran: mine 13, depcheck 84, in both 13, only mine 0, only depcheck 71.
Repos where both tools report exactly the same set: 0 of 13.

## Disagreements

- **fastify/fastify**: only depcheck: `@jsumners/line-reporter` - mine: mentioned in scripts/config (name, bin or shorthand)
- **fastify/fastify**: only depcheck: `autocannon` - mine: mentioned in scripts/config (name, bin or shorthand)
- **fastify/fastify**: only depcheck: `borp` - mine: mentioned in scripts/config (name, bin or shorthand)
- **fastify/fastify**: only depcheck: `branch-comparer` - mine: mentioned in scripts/config (name, bin or shorthand)
- **fastify/fastify**: only depcheck: `concurrently` - mine: mentioned in scripts/config (name, bin or shorthand)
- **fastify/fastify**: only depcheck: `cross-env` - mine: mentioned in scripts/config (name, bin or shorthand)
- **fastify/fastify**: only depcheck: `markdownlint-cli2` - mine: mentioned in scripts/config (name, bin or shorthand)
- **fastify/fastify**: only depcheck: `typescript` - mine: peer dependency of tstyche
- **expressjs/express**: only depcheck: `eslint` - mine: mentioned in scripts/config (name, bin or shorthand)
- **expressjs/express**: only depcheck: `mocha` - mine: mentioned in scripts/config (name, bin or shorthand)
- **expressjs/express**: only depcheck: `nyc` - mine: mentioned in scripts/config (name, bin or shorthand)
- **koajs/koa**: only depcheck: `c8` - mine: mentioned in scripts/config (name, bin or shorthand)
- **koajs/koa**: only depcheck: `gen-esm-wrapper` - mine: mentioned in scripts/config (name, bin or shorthand)
- **koajs/koa**: only depcheck: `snazzy` - mine: mentioned in scripts/config (name, bin or shorthand)
- **koajs/koa**: only depcheck: `standard` - mine: mentioned in scripts/config (name, bin or shorthand)
- **hexojs/hexo**: only depcheck: `c8` - mine: mentioned in scripts/config (name, bin or shorthand)
- **hexojs/hexo**: only depcheck: `eslint` - mine: mentioned in scripts/config (name, bin or shorthand)
- **hexojs/hexo**: only depcheck: `hexo-cli` - mine: imported in bin/hexo
- **hexojs/hexo**: only depcheck: `husky` - mine: mentioned in scripts/config (name, bin or shorthand)
- **hexojs/hexo**: only depcheck: `lint-staged` - mine: mentioned in scripts/config (name, bin or shorthand)
- **hexojs/hexo**: only depcheck: `mocha` - mine: mentioned in scripts/config (name, bin or shorthand)
- **hexojs/hexo**: only depcheck: `typescript` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `@test/esm-only-loader` - mine: skipped: local path dependency
- **mochajs/mocha**: only depcheck: `coffeescript` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `cross-env` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `installed-check` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `knip` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `npm-run-all2` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `nyc` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `prettier` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `typescript` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `webpack` - mine: mentioned in scripts/config (name, bin or shorthand)
- **mochajs/mocha**: only depcheck: `webpack-cli` - mine: companion of another used package
- **postcss/postcss**: only depcheck: `c8` - mine: mentioned in scripts/config (name, bin or shorthand)
- **postcss/postcss**: only depcheck: `check-dts` - mine: mentioned in scripts/config (name, bin or shorthand)
- **postcss/postcss**: only depcheck: `eslint` - mine: mentioned in scripts/config (name, bin or shorthand)
- **postcss/postcss**: only depcheck: `simple-git-hooks` - mine: mentioned in scripts/config (name, bin or shorthand)
- **postcss/postcss**: only depcheck: `size-limit` - mine: mentioned in scripts/config (name, bin or shorthand)
- **postcss/postcss**: only depcheck: `ts-node` - mine: mentioned in scripts/config (name, bin or shorthand)
- **postcss/postcss**: only depcheck: `typescript` - mine: peer dependency of @logux/oxc-configs
- **axios/axios**: only depcheck: `@babel/core` - mine: peer dependency of @babel/preset-env
- **axios/axios**: only depcheck: `@babel/preset-env` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `@commitlint/cli` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `@commitlint/config-conventional` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `cross-env` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `eslint` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `husky` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `playwright` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `prettier` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `rollup` - mine: mentioned in scripts/config (name, bin or shorthand)
- **axios/axios**: only depcheck: `typescript` - mine: peer dependency of cosmiconfig-typescript-loader
- **chalk/chalk**: only depcheck: `c8` - mine: mentioned in scripts/config (name, bin or shorthand)
- **chalk/chalk**: only depcheck: `matcha` - mine: mentioned in scripts/config (name, bin or shorthand)
- **chalk/chalk**: only depcheck: `typescript` - mine: mentioned in scripts/config (name, bin or shorthand)
- **chalk/chalk**: only depcheck: `xo` - mine: mentioned in scripts/config (name, bin or shorthand)
- **tj/commander.js**: only depcheck: `prettier` - mine: mentioned in scripts/config (name, bin or shorthand)
- **tj/commander.js**: only depcheck: `typescript` - mine: mentioned in scripts/config (name, bin or shorthand)
- **winstonjs/winston**: only depcheck: `@babel/cli` - mine: mentioned in scripts/config (name, bin or shorthand)
- **winstonjs/winston**: only depcheck: `@babel/core` - mine: peer dependency of @babel/cli
- **winstonjs/winston**: only depcheck: `eslint` - mine: mentioned in scripts/config (name, bin or shorthand)
- **winstonjs/winston**: only depcheck: `jest` - mine: mentioned in scripts/config (name, bin or shorthand)
- **jprichardson/node-fs-extra**: only depcheck: `nyc` - mine: mentioned in scripts/config (name, bin or shorthand)
- **jprichardson/node-fs-extra**: only depcheck: `standard` - mine: mentioned in scripts/config (name, bin or shorthand)
- **debug-js/debug**: only depcheck: `brfs` - mine: mentioned in scripts/config (name, bin or shorthand)
- **debug-js/debug**: only depcheck: `browserify` - mine: mentioned in scripts/config (name, bin or shorthand)
- **debug-js/debug**: only depcheck: `coveralls` - mine: mentioned in scripts/config (name, bin or shorthand)
- **debug-js/debug**: only depcheck: `karma` - mine: mentioned in scripts/config (name, bin or shorthand)
- **debug-js/debug**: only depcheck: `mocha` - mine: mentioned in scripts/config (name, bin or shorthand)
- **debug-js/debug**: only depcheck: `xo` - mine: mentioned in scripts/config (name, bin or shorthand)
- **expressjs/body-parser**: only depcheck: `eslint` - mine: mentioned in scripts/config (name, bin or shorthand)
- **expressjs/body-parser**: only depcheck: `nyc` - mine: mentioned in scripts/config (name, bin or shorthand)

## Agreed candidates

- **fastify/fastify**: `@stylistic/eslint-plugin` (needed by neostandard; lower confidence: likely loaded by eslint), `@stylistic/eslint-plugin-js` (1; lower confidence: likely loaded by eslint)
- **expressjs/express**: `hbs` (9)
- **mochajs/mocha**: `tsx` (2)
- **postcss/postcss**: `@size-limit/preset-small-lib` (6; lower confidence: likely loaded by size-limit), `multiocular` (17)
- **axios/axios**: `@vitest/browser` (needed by @vitest/browser-playwright; lower confidence: likely loaded by vitest)
- **chalk/chalk**: `yoctodelay` (1)
- **winstonjs/winston**: `abstract-winston-transport` (3)
- **debug-js/debug**: `karma-browserify` (4; lower confidence: likely loaded by karma), `karma-chrome-launcher` (1; lower confidence: likely loaded by karma), `karma-mocha` (1; lower confidence: likely loaded by karma), `mocha-lcov-reporter` (1; lower confidence: likely loaded by mocha)
