# DECISIONS
- Stage 0: git top-level is this folder already; no parent repo problem. No `git init` needed.
- GitHub trees API verified here: `HEAD` accepted (200), shape {sha,url,tree,truncated}, CORS *, 404 for missing repo, limit 60/h. HEAD-then-default_branch fallback is still implemented.
