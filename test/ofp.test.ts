/**
 * Open Factory Plan v0: the conformance fixtures (ofp/fixtures/manifest.json)
 * give the expected issue codes, and the validator must match them exactly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, buildStore, loadGameData, runSparqlText } from '../src/graph.ts';
import { planToNQuads } from '../src/ofp/rdf.ts';
import { type OfpGameData, type Plan, lineFlows, validatePlan } from '../src/ofp/validate.ts';

const FIXTURES = join(ROOT, 'ofp', 'fixtures');

interface ManifestEntry {
  file: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as {
  fixtures: ManifestEntry[];
};
const game = loadGameData();

describe('conformance fixtures', () => {
  it.each(manifest.fixtures.map((f) => [f.file, f] as const))('%s', (_file, fixture) => {
    const plan: unknown = JSON.parse(readFileSync(join(FIXTURES, fixture.file), 'utf8'));
    const result = validatePlan(plan, game);
    const codes = (severity: string) =>
      result.issues
        .filter((i) => i.severity === severity)
        .map((i) => i.code)
        .sort();
    expect({ valid: result.valid, errors: codes('error'), warnings: codes('warning') }).toEqual({
      valid: fixture.valid,
      errors: [...fixture.errors].sort(),
      warnings: [...fixture.warnings].sort(),
    });
  });

  it('covers every rule code at least once', () => {
    const covered = new Set(manifest.fixtures.flatMap((f) => [...f.errors, ...f.warnings]));
    // `ambiguous-building` needs a recipe with two producers; the game has none (see below).
    expect([...covered].sort()).toEqual(
      [
        'building-cannot-run-recipe',
        'duplicate-factory-id',
        'not-exported',
        'over-drawn',
        'recipe-not-machine',
        'schema',
        'self-supplied',
        'surplus',
        'too-many-somersloops',
        'unbalanced',
        'unknown-building',
        'unknown-from-factory',
        'unknown-item',
        'unknown-recipe',
      ].sort(),
    );
  });
});

describe('rules', () => {
  const recipe = {
    id: 'Recipe_X_C',
    durationS: 6,
    ingredients: [{ item: 'Desc_A_C', amount: 3 }],
    products: [{ item: 'Desc_B_C', amount: 2 }],
    producedIn: ['Build_One_C', 'Build_Two_C'],
  };
  const synthetic: OfpGameData = {
    items: [{ id: 'Desc_A_C' }, { id: 'Desc_B_C' }],
    recipes: [recipe],
    buildings: [
      { id: 'Build_One_C', sloopSlots: 2 },
      { id: 'Build_Two_C', sloopSlots: 0 },
    ],
  };
  const planWith = (line: object) => ({
    ofpVersion: '0',
    name: 'Synthetic',
    factories: [{ factoryId: 'f', name: 'F', lines: [line] }],
  });

  it('flows scale with machines and clock; Somersloops scale output only', () => {
    const flows = lineFlows(
      { recipe: recipe.id, machines: 2, clockPercent: 50, somersloops: 1 },
      recipe,
      2,
    );
    // 10 cycles/min × 2 machines × 50% = 10 cycles/min; one of two slots = ×1.5 output.
    expect(Object.fromEntries(flows)).toEqual({ Desc_A_C: -30, Desc_B_C: 30 });
  });

  it('requires "building" when a recipe runs in more than one building', () => {
    const result = validatePlan(planWith({ recipe: recipe.id, machines: 1 }), synthetic);
    expect(result.issues.map((i) => i.code)).toEqual(['ambiguous-building']);
    const chosen = validatePlan(
      planWith({ recipe: recipe.id, building: 'Build_Two_C', machines: 1 }),
      synthetic,
    );
    expect(chosen.issues.map((i) => i.code).sort()).toEqual(['surplus', 'unbalanced']);
  });

  it('reports a JSON Pointer to the offending value', () => {
    const result = validatePlan(
      planWith({ recipe: recipe.id, building: 'Build_Nope_C', machines: 1 }),
      synthetic,
    );
    expect(result.issues[0]?.path).toBe('/factories/0/lines/0/building');
  });

  it('rejects anything that is not a plan', () => {
    for (const value of [null, 42, 'plan', [], {}]) {
      expect(validatePlan(value, synthetic).valid).toBe(false);
    }
  });
});

describe('RDF view', () => {
  it('links a plan to the game graph, so SPARQL can join them', async () => {
    const plan = JSON.parse(
      readFileSync(join(FIXTURES, 'valid', 'two-factories.json'), 'utf8'),
    ) as Plan;
    const store = await buildStore(game);
    store.load(await planToNQuads(plan, 'https://example.org/plans/screws'), {
      format: 'application/n-quads',
    });
    // Base power of every machine in the plan, from the game data's building power.
    const [row] = runSparqlText(
      store,
      `PREFIX ofp: <https://solstice035.github.io/ficsit-knowledge-model/ofp#>
      SELECT (SUM(?machines * ?mw) AS ?mwTotal) (COUNT(?line) AS ?lines) WHERE {
        <https://example.org/plans/screws> a ofp:Plan ; ofp:factories/ofp:lines ?line .
        ?line ofp:machines ?machines ; ofp:recipe/ficsit:producedIn/ficsit:powerMW ?mw .
      }`,
    );
    // Smelter 4 MW + Constructor 4 MW + 3 Constructors × 4 MW.
    expect(row).toEqual({ mwTotal: 20, lines: 3 });
    const [link] = runSparqlText(
      store,
      `PREFIX ofp: <https://solstice035.github.io/ficsit-knowledge-model/ofp#>
      SELECT ?from WHERE { ?f ofp:inputs/ofp:fromFactory ?from }`,
    );
    expect(link?.from).toBe('https://example.org/plans/screws/factory/ingots');
  });
});
