# PLAN

Stages (each ends with checks, then a commit):
0. Env/git check. 1. extract/github/analyze + offline tests. 2. registry/graph + tests with a fake registry.
3. pipeline + plain-text UI + acceptance script run on real repos (fastify, hexo, mocha).
4. Canvas visualization + full UI, verified in a real browser (screenshots in docs/).
5. validate.mjs vs depcheck on ~10 repos -> results/validation.md. 6. README. 7. Pages workflow + publish commands.

Risks: GitHub API 60 req/h (use GITHUB_TOKEN in scripts); regex false ghosts (prefer over-counting usage);
registry data drifts (numbers approximate); browser verification tooling (Playwright availability); time.

Verify: `node --test test/`, acceptance on real repos, browser screenshots + console errors, validation table.
