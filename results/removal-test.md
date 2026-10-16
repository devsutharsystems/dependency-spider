# Removal test: 1 repo, 1 candidate

Date: 2026-10-16. Node v24.21.0. Done in a throwaway clone outside this project (`git clone --depth 1 https://github.com/expressjs/express.git`, commit `a419aa7350389a275ab45fde2e849ed1f02449ef`).

The scanner flags exactly one candidate for express: `hbs` (devDependency, `^4.3.1`); depcheck (no install) flags it too.

| Step | Command | Result |
|---|---|---|
| 1. install | `npm install --no-audit --no-fund` | exit 0 |
| 2. baseline tests | `npm test` (= `mocha --require test/support/env --reporter spec --check-leaks test/ test/acceptance/`) | **1261 passing, exit 0** |
| 3. remove candidate | `npm uninstall -D hbs --no-audit --no-fund` (package.json: 1 line removed; `node_modules/hbs` gone) | exit 0 |
| 4. tests again | `npm test` | **1255 passing, 6 failing, exit 6** |

All 6 failures are in `test/acceptance/mvc.js` (`GET /users`, `/user/:id`, `/user/:id/pets`, edit, update, create pet): "expected 200 OK, got 500 Internal Server Error".

## Why: this is a false positive of the scanner

`examples/mvc/controllers/user/index.js` contains `exports.engine = 'hbs'`, and `examples/mvc/lib/boot.js` does `app.set('view engine', obj.engine)`. Express then loads the engine by name at runtime (`require('hbs')`). The package is never named in an `import`/`require` call and no script mentions it, so a regex scanner cannot see the use. depcheck makes the same mistake here.

Not generalised: this is one repo and one candidate. It shows that "candidate" has to be read literally, and that view engines, loaders and plugins resolved by name from a string are a blind spot. I did not add a special rule for it.
