#!/usr/bin/env sh
# Packs the npm package, installs it into a scratch project and uses it as a
# consumer would: load the bundled data, validate a fixture plan, read a schema.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"
TARBALL="$(npm pack --pack-destination "$WORK" --silent | tail -n 1)"
cp ofp/fixtures/valid/two-factories.json "$WORK/plan.json"
cd "$WORK"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "./$TARBALL"
cat > smoke.mjs <<'JS'
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadGameData, validatePlan } from 'ficsit-knowledge-model';

const game = loadGameData();
const result = validatePlan(JSON.parse(readFileSync('plan.json', 'utf8')), game);
if (!result.valid) throw new Error(`fixture plan invalid: ${JSON.stringify(result.issues)}`);
const require = createRequire(import.meta.url);
const schema = require('ficsit-knowledge-model/schema/ofp.schema.json');
if (schema.$id !== 'https://solstice035.github.io/ficsit-knowledge-model/ofp') throw new Error('bad schema');
require.resolve('ficsit-knowledge-model/game.sqlite');
console.log(`✓ package works: ${game.items.length} items, ${game.sources.length} sources, plan valid`);
JS
node smoke.mjs
