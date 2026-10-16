I built Dependency Spider: paste a GitHub repo, and it lists dependencies the code never uses, then shows how many packages leave the tree if you drop them.

My first claim was that fastify's branch-comparer is unused. It isn't. A script runs `branchcmp`, which is that package's CLI name. Matching bin names fixed it, so the tool now says no.

What I measured on 16 Oct 2026:
- postcss: 3 candidates, tree 228 to 204 packages (-24, 10.5%). depcheck flags the same three.
- Across 13 repos, depcheck without an install flagged 84 packages, mine 15. After installing dependencies on 3 repos, depcheck's flags fell from 23 to 8, so most of the gap was the missing install.
- On express I removed my one candidate, hbs, and ran the tests: 6 failed. Express loads view engines by name at runtime, so that was a false positive.

Read the output as candidates, not verdicts. It is regex based, follows npm's latest versions, and I have tested one removal.

Code and write-up: https://github.com/I-am-Dev-Suthar/dependency-spider
