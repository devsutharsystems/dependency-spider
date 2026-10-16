I built Dependency Spider with Claude Code. Paste a GitHub repo and it lists dependencies the code never uses, then shows how many packages leave the tree if you remove them.

Three things I learned, from runs on 16 Oct 2026:

1. I first believed fastify's branch-comparer was unused. A script runs `branchcmp`, its CLI name. Matching bin names fixed that.

2. Removal tests found false positives. On express I removed my one candidate, hbs, and 6 tests failed: express loads view engines by name at runtime. On postcss, removing all three candidates passed the unit tests but broke the size check, because size-limit loads its plugin by name.

3. My first depcheck comparison was unfair. I ran depcheck without installing dependencies. After installing them on 3 repos, its flags fell from 23 to 8, and we overlapped on 6 of my 8. Agreement is not correctness either: both tools flagged hbs.

So the output is candidates, not verdicts.

Code and write-up: https://github.com/I-am-Dev-Suthar/dependency-spider
