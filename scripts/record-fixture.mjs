// Records a real scan as a JSON fixture for offline animation tests (scripts/perf.mjs, ?fixture= in the app).
// Usage: node scripts/record-fixture.mjs owner/repo name [--stale]   -> scripts/fixtures/<name>.json   (needs network)
// --stale also fetches each package's `modified` date (large downloads), so the fixture replays with staleness colours.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../src/pipeline.js';
import { serializeResult } from '../src/fixture.js';

const [, , repo, name] = process.argv;
const stale = process.argv.includes('--stale');
const r = await runPipeline(repo, { token: process.env.GITHUB_TOKEN, withModified: stale, awaitModified: stale });
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', `${name}.json`);
writeFileSync(out, JSON.stringify(serializeResult(r)));
console.log(`${repo}: ${r.graph.nodes.size} nodes, ${r.ghosts.length} candidates, shed ${r.shed.combinedShed} -> ${out}`);
