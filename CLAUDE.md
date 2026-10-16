# Dependency Spider - project rules
- The path contains SPACES: always quote paths in shell commands.
- No framework, no bundler, no LLM, no API keys, no backend, no CDN scripts. Plain ES modules.
- Tests: `node --test test/`. Serve: `python3 -m http.server 8000` then open http://localhost:8000
- Acceptance (real network): `GITHUB_TOKEN=... node scripts/acceptance.mjs`. Validation: `node scripts/validate.mjs`.
- Wording: "candidates, verify before removing" - never "safe to remove". README separates verified from assumed.
- Do not strip /* */ comments in extract.js (globs break it). Never search dependency maps in analyze.js.
