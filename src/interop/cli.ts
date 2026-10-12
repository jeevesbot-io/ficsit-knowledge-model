/**
 * Converts plans between Open Factory Plan and other planners.
 *
 * Usage:
 *   npm run ofp:convert -- import sft plans.sft plan.ofp.json
 *   npm run ofp:convert -- import logistics backup.json plan.ofp.json
 *   npm run ofp:convert -- export sft plan.ofp.json plans.sft
 *   npm run ofp:convert -- export logistics plan.ofp.json backup.json
 *
 * Exports require a valid plan. Notes on anything a format can't hold go to stderr.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadGameData } from '../graph.ts';
import { type Plan, validatePlan } from '../ofp/validate.ts';
import type { Conversion } from './common.ts';
import { planFromLogistics, planToLogistics } from './satisfactory-logistics.ts';
import { decodeSft, encodeSft, planFromSft, planToSft } from './satisfactory-tools.ts';

const [direction, format, input, output] = process.argv.slice(2);
const formats = ['sft', 'logistics'];
if (
  !direction ||
  !['import', 'export'].includes(direction) ||
  !format ||
  !formats.includes(format) ||
  !input ||
  !output
) {
  console.error('Usage: npm run ofp:convert -- <import|export> <sft|logistics> <in> <out>');
  process.exit(2);
}

const game = loadGameData();
const report = (notes: string[]) => {
  for (const n of notes) console.error(`  note: ${n}`);
};
const text = readFileSync(input, 'utf8');

if (direction === 'import') {
  const result: Conversion<Plan> =
    format === 'sft' ? planFromSft(decodeSft(text)) : planFromLogistics(JSON.parse(text));
  report(result.notes);
  const check = validatePlan(result.value, game);
  for (const i of check.issues) console.error(`  ${i.severity} ${i.code} ${i.path}: ${i.message}`);
  writeFileSync(output, `${JSON.stringify(result.value, null, 2)}\n`);
  console.log(`${check.valid ? '✓' : '✗'} wrote ${output}`);
  process.exitCode = check.valid ? 0 : 1;
} else {
  const plan: unknown = JSON.parse(text);
  const check = validatePlan(plan, game);
  if (!check.valid) {
    for (const i of check.issues)
      console.error(`  ${i.severity} ${i.code} ${i.path}: ${i.message}`);
    console.error(`✗ ${input} is not a valid plan; nothing written`);
    process.exit(1);
  }
  if (format === 'sft') {
    const result = planToSft(plan as Plan, game);
    report(result.notes);
    writeFileSync(output, encodeSft(result.value));
  } else {
    const result = planToLogistics(plan as Plan);
    report(result.notes);
    writeFileSync(output, `${JSON.stringify(result.value, null, 2)}\n`);
  }
  console.log(`✓ wrote ${output}`);
}
