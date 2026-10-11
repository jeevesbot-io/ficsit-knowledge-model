/**
 * Validates Open Factory Plan files against the schema and the game data.
 *
 * Usage: npm run ofp:validate -- plan.json [more.json …]   (exit code 1 on errors)
 */
import { readFileSync } from 'node:fs';
import { loadGameData } from '../graph.ts';
import { validatePlan } from './validate.ts';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run ofp:validate -- plan.json [more.json …]');
  process.exit(2);
}

const game = loadGameData();
let failed = false;
for (const file of files) {
  let plan: unknown;
  try {
    plan = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.log(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }
  const { valid, issues } = validatePlan(plan, game);
  console.log(`${valid ? '✓' : '✗'} ${file}`);
  for (const i of issues) {
    console.log(
      `  ${i.severity === 'error' ? 'error  ' : 'warning'} ${i.code} ${i.path}: ${i.message}`,
    );
  }
  failed ||= !valid;
}
process.exitCode = failed ? 1 : 0;
