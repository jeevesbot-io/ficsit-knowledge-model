/**
 * Open Factory Plan v0 validator (see ofp/SPEC.md).
 *
 * Two layers: the LinkML-generated JSON Schema (`model/generated/ofp.schema.json`)
 * checks structure, then the rules below check the plan against game data.
 * Every issue has a stable `code`; ofp/fixtures/ pins the expected codes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2019 from 'ajv/dist/2019.js';
import type { Building, Item, Recipe } from '../types.ts';

const MODEL_DIR = join(import.meta.dirname, '..', '..', 'model', 'generated');

export type Severity = 'error' | 'warning';

export interface OfpIssue {
  severity: Severity;
  code: string;
  /** JSON Pointer to the offending value, e.g. `/factories/0/lines/1/building`. */
  path: string;
  message: string;
}

export interface OfpResult {
  /** True when there are no errors (warnings allowed). */
  valid: boolean;
  issues: OfpIssue[];
}

/** The game data a plan is checked against. */
export interface OfpGameData {
  items: Pick<Item, 'id'>[];
  recipes: Pick<Recipe, 'id' | 'durationS' | 'ingredients' | 'products' | 'producedIn'>[];
  buildings: Pick<Building, 'id' | 'sloopSlots'>[];
}

// Types of a structurally valid plan (mirrors model/ofp.linkml.yaml).
export interface ItemRate {
  item: string;
  ratePerMin: number;
}
export interface FactoryInput extends ItemRate {
  fromFactory?: string;
}
export interface ProductionLine {
  recipe: string;
  building?: string;
  machines: number;
  clockPercent?: number;
  somersloops?: number;
}
export interface Factory {
  factoryId: string;
  name: string;
  location?: { x: number; y: number; z?: number };
  outputs?: ItemRate[];
  inputs?: FactoryInput[];
  lines?: ProductionLine[];
}
export interface Plan {
  ofpVersion: '0';
  name: string;
  description?: string;
  gameVersion?: string;
  tool?: { name: string; toolVersion?: string; url?: string };
  factories: Factory[];
}

let schemaValidator: ReturnType<Ajv2019['compile']> | undefined;

function checkSchema(plan: unknown): OfpIssue[] {
  if (!schemaValidator) {
    const schema = JSON.parse(readFileSync(join(MODEL_DIR, 'ofp.schema.json'), 'utf8'));
    const ajv = new Ajv2019({ allErrors: true, strict: false });
    ajv.addFormat('uri', (value: string) => URL.canParse(value));
    schemaValidator = ajv.compile(schema);
  }
  if (schemaValidator(plan)) return [];
  return (schemaValidator.errors ?? []).map((e) => ({
    severity: 'error',
    code: 'schema',
    path: e.instancePath,
    message: `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
  }));
}

/** Relative tolerance for flow balance, so rounding in rates isn't flagged. */
const TOLERANCE = 1e-6;

const fmt = (n: number): string => String(Number(n.toFixed(4)));

/** Per-minute flows of one production line: positive is made, negative is used. */
export function lineFlows(
  line: ProductionLine,
  recipe: OfpGameData['recipes'][number],
  sloopSlots: number,
) {
  const cyclesPerMin = (60 / recipe.durationS) * ((line.clockPercent ?? 100) / 100) * line.machines;
  // Somersloops amplify output only: with every slot filled, output doubles.
  const amplify = sloopSlots > 0 ? 1 + (line.somersloops ?? 0) / sloopSlots : 1;
  const flows = new Map<string, number>();
  const add = (item: string, rate: number) => flows.set(item, (flows.get(item) ?? 0) + rate);
  for (const x of recipe.ingredients) add(x.item, -x.amount * cyclesPerMin);
  for (const x of recipe.products) add(x.item, x.amount * cyclesPerMin * amplify);
  return flows;
}

/** Validates a parsed plan (any JSON value) against the schema and the game data. */
export function validatePlan(plan: unknown, game: OfpGameData): OfpResult {
  const schemaIssues = checkSchema(plan);
  // Structure is unknown, so the semantic rules can't run safely.
  if (schemaIssues.length) return { valid: false, issues: schemaIssues };

  const p = plan as Plan;
  const issues: OfpIssue[] = [];
  const error = (code: string, path: string, message: string) =>
    issues.push({ severity: 'error', code, path, message });
  const warning = (code: string, path: string, message: string) =>
    issues.push({ severity: 'warning', code, path, message });

  const items = new Set(game.items.map((i) => i.id));
  const recipes = new Map(game.recipes.map((r) => [r.id, r]));
  const buildings = new Map(game.buildings.map((b) => [b.id, b]));

  const factoryIndex = new Map<string, number>();
  p.factories.forEach((f, i) => {
    if (factoryIndex.has(f.factoryId)) {
      error(
        'duplicate-factory-id',
        `/factories/${i}/factoryId`,
        `Factory ID "${f.factoryId}" is used twice`,
      );
    } else {
      factoryIndex.set(f.factoryId, i);
    }
  });

  /** Rate drawn from each (factory, item) by other factories. */
  const drawn = new Map<string, { rate: number; paths: string[] }>();

  p.factories.forEach((f, fi) => {
    const base = `/factories/${fi}`;
    /** Per item: supply is production + inputs; demand is consumption + outputs. */
    const supply = new Map<string, number>();
    const demand = new Map<string, number>();
    const add = (map: Map<string, number>, item: string, rate: number) =>
      map.set(item, (map.get(item) ?? 0) + rate);
    let linesOk = true;

    (f.outputs ?? []).forEach((o, i) => {
      if (!items.has(o.item))
        error('unknown-item', `${base}/outputs/${i}/item`, `Unknown item "${o.item}"`);
      add(demand, o.item, o.ratePerMin);
    });

    (f.inputs ?? []).forEach((input, i) => {
      const path = `${base}/inputs/${i}`;
      if (!items.has(input.item))
        error('unknown-item', `${path}/item`, `Unknown item "${input.item}"`);
      add(supply, input.item, input.ratePerMin);
      if (input.fromFactory === undefined) return;
      const source = factoryIndex.get(input.fromFactory);
      if (input.fromFactory === f.factoryId) {
        error(
          'self-supplied',
          `${path}/fromFactory`,
          `Factory "${f.factoryId}" can't supply itself`,
        );
      } else if (source === undefined) {
        error(
          'unknown-from-factory',
          `${path}/fromFactory`,
          `No factory "${input.fromFactory}" in the plan`,
        );
      } else {
        const key = `${input.fromFactory}\u0000${input.item}`;
        const entry = drawn.get(key) ?? { rate: 0, paths: [] };
        entry.rate += input.ratePerMin;
        entry.paths.push(path);
        drawn.set(key, entry);
      }
    });

    (f.lines ?? []).forEach((line, i) => {
      const path = `${base}/lines/${i}`;
      const recipe = recipes.get(line.recipe);
      if (!recipe) {
        error('unknown-recipe', `${path}/recipe`, `Unknown recipe "${line.recipe}"`);
        linesOk = false;
        return;
      }
      if (!recipe.producedIn.length) {
        error(
          'recipe-not-machine',
          `${path}/recipe`,
          `"${line.recipe}" isn't made in a production building`,
        );
        linesOk = false;
        return;
      }
      let buildingId = line.building;
      if (buildingId === undefined) {
        if (recipe.producedIn.length > 1) {
          error(
            'ambiguous-building',
            path,
            `"${line.recipe}" runs in ${recipe.producedIn.join(', ')}: set "building"`,
          );
          linesOk = false;
          return;
        }
        buildingId = recipe.producedIn[0] ?? '';
      } else if (!buildings.has(buildingId)) {
        error('unknown-building', `${path}/building`, `Unknown building "${buildingId}"`);
        linesOk = false;
        return;
      } else if (!recipe.producedIn.includes(buildingId)) {
        error(
          'building-cannot-run-recipe',
          `${path}/building`,
          `"${buildingId}" can't run "${line.recipe}" (runs in ${recipe.producedIn.join(', ')})`,
        );
        linesOk = false;
        return;
      }
      const slots = buildings.get(buildingId)?.sloopSlots ?? 0;
      if ((line.somersloops ?? 0) > slots) {
        error(
          'too-many-somersloops',
          `${path}/somersloops`,
          `${line.somersloops} Somersloops per machine, but "${buildingId}" has ${slots} slot(s)`,
        );
        linesOk = false;
        return;
      }
      for (const [item, rate] of lineFlows(line, recipe, slots)) {
        if (rate > 0) add(supply, item, rate);
        else add(demand, item, -rate);
      }
    });

    // Balance only factories with lines, and only when every line is understood.
    if (!f.lines?.length || !linesOk) return;
    for (const item of new Set([...supply.keys(), ...demand.keys()])) {
      const s = supply.get(item) ?? 0;
      const d = demand.get(item) ?? 0;
      const slack = TOLERANCE * Math.max(1, s, d);
      if (s < d - slack) {
        error('unbalanced', base, `${item}: needs ${fmt(d)}/min but gets ${fmt(s)}/min`);
      } else if (s > d + slack) {
        warning('surplus', base, `${item}: ${fmt(s - d)}/min left over (not an output)`);
      }
    }
  });

  for (const [key, { rate, paths }] of drawn) {
    const [fromId = '', item = ''] = key.split('\u0000');
    const from = p.factories[factoryIndex.get(fromId) ?? -1];
    const offered = (from?.outputs ?? [])
      .filter((o) => o.item === item)
      .reduce((n, o) => n + o.ratePerMin, 0);
    const firstPath = paths[0] ?? '';
    if (offered === 0) {
      error('not-exported', firstPath, `"${fromId}" doesn't list ${item} as an output`);
    } else if (rate > offered * (1 + TOLERANCE)) {
      error(
        'over-drawn',
        firstPath,
        `${item}: ${fmt(rate)}/min drawn from "${fromId}", which outputs ${fmt(offered)}/min`,
      );
    }
  }

  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}
