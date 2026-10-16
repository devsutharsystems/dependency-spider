I built Dependency Spider with Claude Code. Paste a GitHub repo and it lists dependencies the code never uses, then shows how many packages leave the tree if you remove them.

What I learned, from runs on 16 Oct 2026:

1. I first believed fastify's branch-comparer was unused. A script runs `branchcmp`, its CLI name. Matching bin names fixed that.

2. I removed candidates and ran the repos' own tests. Four candidates, three wrong: express's hbs (6 tests fail; view engines load by name), postcss's size-limit preset (the size check fails; plugins load by name), and simple-git-hooks (a scanner bug: it is configured by its own package.json key, now fixed). The fourth, multiocular, is unconfirmed. None of the four is confirmed unused.

3. My first depcheck comparison was unfair: I ran it without installing dependencies. With them installed on 3 repos, its flags fell from 23 to 8, and we overlap on 5 of my 7.

So the output is candidates, not verdicts.

Code and write-up: <REPO_URL>
