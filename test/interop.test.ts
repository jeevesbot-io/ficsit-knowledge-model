/**
 * Converters between Open Factory Plan and other open-source planners.
 * Imports must produce valid plans; exports must keep what the target can hold.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, loadGameData } from '../src/graph.ts';
import { planFromLogistics, planToLogistics } from '../src/interop/satisfactory-logistics.ts';
import { decodeSft, encodeSft, planFromSft, planToSft } from '../src/interop/satisfactory-tools.ts';
import { type Plan, validatePlan } from '../src/ofp/validate.ts';

const game = loadGameData();
const fixture = (name: string): Plan =>
  JSON.parse(readFileSync(join(ROOT, 'ofp', 'fixtures', 'valid', name), 'utf8')) as Plan;
const VALID = [
  'iron-plates.json',
  'targets-only.json',
  'plastic-byproduct.json',
  'two-factories.json',
  'somersloop.json',
  'surplus-warning.json',
];
const flows = (plan: Plan) =>
  plan.factories.map((f) => ({ outputs: f.outputs ?? [], inputs: f.inputs ?? [] }));

describe('SatisfactoryTools (.sft)', () => {
  it('reads the file layout it writes: comments, version, base64 zlib JSON', () => {
    const tabs = planToSft(fixture('iron-plates.json'), game).value;
    const text = encodeSft(tabs, new Date('2026-10-11T00:00:00Z'));
    expect(text).toMatch(/^# Satisfactory Tools export \(version 1\)\n/);
    expect(text).toContain('# - Iron plates\n');
    expect(text).toContain('# Exported on 2026-10-11T00:00:00.000Z');
    expect(decodeSft(text.replace(/\n/g, '\r\n'))).toEqual(tabs);
    expect(() => decodeSft('# comment\n1abc')).toThrow(/version/);
  });

  it('maps world raw inputs to resource limits, and other inputs to provided items', () => {
    const [ingots, screws] = planToSft(fixture('two-factories.json'), game).value;
    expect(ingots?.request.resourceMax.Desc_OreIron_C).toBe(30);
    expect(ingots?.request.resourceMax.Desc_Coal_C).toBe(0);
    expect(ingots?.request.production).toEqual([
      { item: 'Desc_IronIngot_C', type: 'perMinute', amount: 30, ratio: 100 },
    ]);
    expect(screws?.request.resourceMax.Desc_OreIron_C).toBe(0);
    expect(screws?.request.input).toEqual([{ item: 'Desc_IronIngot_C', amount: 30 }]);
    // A targets-only factory leaves raw resources open for the solver.
    const [open] = planToSft(fixture('targets-only.json'), game).value;
    expect(open?.request.resourceMax.Desc_OreIron_C).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('allows the alternates a plan uses', () => {
    const plan: Plan = {
      ofpVersion: '0',
      name: 'Alt wire',
      factories: [
        {
          factoryId: 'wire',
          name: 'Wire',
          lines: [{ recipe: 'Recipe_Alternate_Wire_1_C', machines: 1 }],
        },
      ],
    };
    const { value, notes } = planToSft(plan, game);
    expect(value[0]?.request.allowedAlternateRecipes).toEqual(['Recipe_Alternate_Wire_1_C']);
    expect(notes.join('\n')).toMatch(/solver request/);
  });

  it.each(VALID)('round-trips the targets and inputs of %s, and the import validates', (name) => {
    const plan = fixture(name);
    const tabs = decodeSft(encodeSft(planToSft(plan, game).value));
    const back = planFromSft(tabs, plan.name).value;
    expect(validatePlan(back, game).valid).toBe(true);
    // World raw inputs travel as limits, not inputs, so compare outputs and provided items.
    const raw = new Set(game.items.filter((i) => i.isResource).map((i) => i.id));
    expect(flows(back)).toEqual(
      flows(plan).map((f) => ({
        outputs: f.outputs,
        inputs: f.inputs
          .filter((i) => !raw.has(i.item) || i.fromFactory !== undefined)
          .map((i) => ({ item: i.item, ratePerMin: i.ratePerMin })),
      })),
    );
  });

  it('notes what OFP v0 cannot hold', () => {
    const [tab] = planToSft(fixture('targets-only.json'), game).value;
    if (!tab) throw new Error('no tab');
    tab.request.production.push({ item: 'Desc_Motor_C', type: 'max', amount: 0, ratio: 100 });
    tab.request.allowedAlternateRecipes.push('Recipe_Alternate_Wire_1_C');
    const { value, notes } = planFromSft([tab, tab]);
    expect(value.factories.map((f) => f.factoryId)).toEqual(['frames', 'frames-2']);
    expect(notes.join('\n')).toMatch(/maximise Desc_Motor_C/);
    expect(notes.join('\n')).toMatch(/recipe and machine choices/);
  });
});

describe('satisfactory-logistics', () => {
  const backup: unknown = JSON.parse(
    readFileSync(join(ROOT, 'test', 'fixtures', 'interop', 'logistics-game.json'), 'utf8'),
  );

  it('imports a game backup: factory links, world inputs, and notes on the rest', () => {
    const { value, notes } = planFromLogistics(backup);
    expect(validatePlan(value, game)).toEqual({ valid: true, issues: [] });
    expect(value.factories.map((f) => f.factoryId)).toEqual(['f-ingots', 'f-screws']);
    expect(value.factories[0]?.inputs).toEqual([{ item: 'Desc_OreIron_C', ratePerMin: 30 }]);
    expect(value.factories[1]?.inputs).toEqual([
      { item: 'Desc_IronIngot_C', ratePerMin: 30, fromFactory: 'f-ingots' },
    ]);
    const text = notes.join('\n');
    expect(text).toMatch(/maximise Desc_IronPlate_C/);
    expect(text).toMatch(/"max" input constraints/);
  });

  it('imports a single-factory export', () => {
    const data = backup as { factories: object[] };
    const single = {
      schemaVersion: 1,
      kind: 'factory',
      factory: data.factories[0],
      exportedAt: '2026-10-11T00:00:00Z',
    };
    const { value, notes } = planFromLogistics(single);
    expect(value.name).toBe('Screw works');
    // Its supplier isn't in the file, so the link becomes a world input.
    expect(value.factories[0]?.inputs).toEqual([{ item: 'Desc_IronIngot_C', ratePerMin: 30 }]);
    expect(notes.join('\n')).toMatch(/not in the file/);
    expect(() => planFromLogistics({ kind: 'game' })).toThrow(/Not a satisfactory-logistics/);
  });

  it.each(VALID)('round-trips the targets and inputs of %s', (name) => {
    const plan = fixture(name);
    const exported = planToLogistics(plan).value;
    expect(exported.game.factoriesIds).toEqual(plan.factories.map((f) => f.factoryId));
    const back = planFromLogistics(JSON.parse(JSON.stringify(exported))).value;
    expect(flows(back)).toEqual(flows(plan));
    expect(validatePlan(back, game).valid).toBe(true);
  });

  it('limits each solver to the recipes the plan uses', () => {
    const { value } = planToLogistics(fixture('two-factories.json'));
    expect(value.solvers).toEqual([
      { id: 'ingots', isFactory: true, request: { allowedRecipes: ['Recipe_IngotIron_C'] } },
      {
        id: 'screws',
        isFactory: true,
        request: { allowedRecipes: ['Recipe_IronRod_C', 'Recipe_Screw_C'] },
      },
    ]);
  });
});
