/**
 * Open Factory Plan ⇄ SatisfactoryTools production planner (greeny/SatisfactoryTools).
 *
 * Its `.sft` export file is `#` comment lines plus one payload line: `0` (the
 * file version) followed by base64 of zlib-deflated JSON
 * `{ type: 'tabs', tabs: IProductionData[] }`. Each tab is a solver request:
 * targets, inputs, raw-resource limits and allowed alternates. It has no
 * production lines, so plans travel as targets and SatisfactoryTools re-solves.
 * Written from the format, not from its code.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import type { Factory, FactoryInput, ItemRate, Plan } from '../ofp/validate.ts';
import type { Item, Recipe } from '../types.ts';
import { type Conversion, uniqueSlug } from './common.ts';

const FILE_VERSION = '0';
const PER_MINUTE = 'perMinute';
/** SatisfactoryTools' own value for an unlimited raw resource (it uses it for water). */
const UNLIMITED = Number.MAX_SAFE_INTEGER;

/** One production tab (SatisfactoryTools `IProductionData`). */
export interface SftTab {
  metadata: {
    name: string | null;
    icon: string | null;
    schemaVersion: number;
    gameVersion: string;
  };
  request: {
    resourceMax: { [item: string]: number };
    resourceWeight: { [item: string]: number };
    blockedResources: string[];
    blockedRecipes: string[];
    blockedMachines?: string[];
    allowedAlternateRecipes: string[];
    sinkableResources: string[];
    production: { item: string | null; type: string; amount: number; ratio: number }[];
    input: { item: string | null; amount: number }[];
  };
}

/** Decodes an `.sft` file into its tabs. */
export function decodeSft(text: string): SftTab[] {
  const payload = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .join('');
  if (payload.charAt(0) !== FILE_VERSION) {
    throw new Error(
      `Unsupported .sft file version "${payload.charAt(0)}" (expected ${FILE_VERSION})`,
    );
  }
  const json = inflateSync(Buffer.from(payload.slice(1), 'base64')).toString('utf8');
  const parsed = JSON.parse(json) as { type?: string; tabs?: SftTab[] };
  if (parsed.type !== 'tabs' || !Array.isArray(parsed.tabs)) {
    throw new Error('Not a SatisfactoryTools tabs export');
  }
  return parsed.tabs;
}

/** Encodes tabs as an `.sft` file, in the layout SatisfactoryTools writes. */
export function encodeSft(tabs: SftTab[], exportedAt = new Date()): string {
  const payload = deflateSync(Buffer.from(JSON.stringify({ type: 'tabs', tabs }), 'utf8'));
  const names = tabs.map((t) => `# - ${t.metadata.name ?? 'Untitled'}\n`).join('');
  return (
    `# Satisfactory Tools export (version 1)\n\n# Contains these production lines:\n${names}\n` +
    `${FILE_VERSION}${payload.toString('base64')}\n\n# Exported on ${exportedAt.toISOString()}\n`
  );
}

/** SatisfactoryTools tabs → an OFP plan with one targets-only factory per tab. */
export function planFromSft(tabs: SftTab[], name = 'SatisfactoryTools import'): Conversion<Plan> {
  const notes: string[] = [];
  const used = new Set<string>();
  const factories: Factory[] = tabs.map((tab, i) => {
    const label = tab.metadata.name ?? `Tab ${i + 1}`;
    const r = tab.request;
    const outputs: ItemRate[] = [];
    for (const p of r.production) {
      if (!p.item) continue;
      if (p.type !== PER_MINUTE) {
        notes.push(`${label}: "maximise ${p.item}" has no OFP v0 equivalent; skipped`);
      } else if (p.amount > 0) {
        outputs.push({ item: p.item, ratePerMin: p.amount });
      }
    }
    const inputs: FactoryInput[] = r.input
      .filter((x): x is { item: string; amount: number } => !!x.item && x.amount > 0)
      .map((x) => ({ item: x.item, ratePerMin: x.amount }));
    if (r.allowedAlternateRecipes.length || r.blockedRecipes.length || r.blockedMachines?.length) {
      notes.push(`${label}: recipe and machine choices aren't in OFP v0; dropped`);
    }
    if (r.sinkableResources.length || r.blockedResources.length) {
      notes.push(`${label}: sinkable and blocked resources aren't in OFP v0; dropped`);
    }
    return {
      factoryId: uniqueSlug(label, used, `tab-${i + 1}`),
      name: label,
      ...(outputs.length ? { outputs } : {}),
      ...(inputs.length ? { inputs } : {}),
    };
  });
  notes.push("Raw-resource limits (resourceMax) aren't in OFP v0; dropped");
  return {
    value: {
      ofpVersion: '0',
      name,
      tool: { name: 'SatisfactoryTools', url: 'https://github.com/greeny/SatisfactoryTools' },
      factories,
    },
    notes,
  };
}

/** The game data an export needs: raw resources and which recipes are alternates. */
export interface SftGameData {
  items: Pick<Item, 'id' | 'isResource'>[];
  recipes: Pick<Recipe, 'id' | 'alternate'>[];
}

/**
 * An OFP plan → SatisfactoryTools tabs, one per factory. Outputs become
 * targets. World inputs of raw resources become the raw-resource limits, so
 * the solver works within the plan's supply. Other inputs (items from other
 * factories) become provided inputs. Alternates the plan uses are allowed.
 * A factory with neither inputs nor lines gets unlimited raw resources.
 */
export function planToSft(plan: Plan, game: SftGameData): Conversion<SftTab[]> {
  const notes: string[] = [];
  const raw = new Set(game.items.filter((i) => i.isResource).map((i) => i.id));
  const alternates = new Set(game.recipes.filter((r) => r.alternate).map((r) => r.id));
  const tabs = plan.factories.map((f): SftTab => {
    const inputs = f.inputs ?? [];
    const lines = f.lines ?? [];
    const open = !inputs.length && !lines.length;
    const resourceMax: { [item: string]: number } = {};
    for (const id of raw) resourceMax[id] = open ? UNLIMITED : 0;
    const provided: { item: string; amount: number }[] = [];
    for (const input of inputs) {
      if (raw.has(input.item) && input.fromFactory === undefined) {
        resourceMax[input.item] = (resourceMax[input.item] ?? 0) + input.ratePerMin;
      } else {
        provided.push({ item: input.item, amount: input.ratePerMin });
      }
    }
    if (lines.length) {
      notes.push(
        `${f.name}: production lines become a solver request; SatisfactoryTools may pick other standard recipes`,
      );
    }
    if (lines.some((l) => (l.clockPercent ?? 100) !== 100 || (l.somersloops ?? 0) > 0)) {
      notes.push(
        `${f.name}: clock speeds and Somersloops aren't in SatisfactoryTools requests; dropped`,
      );
    }
    return {
      metadata: {
        name: f.name,
        icon: f.outputs?.[0]?.item ?? null,
        schemaVersion: 1,
        gameVersion: '0',
      },
      request: {
        resourceMax,
        // SatisfactoryTools replaces the weights with its defaults on import.
        resourceWeight: {},
        blockedResources: [],
        blockedRecipes: [],
        blockedMachines: [],
        allowedAlternateRecipes: [
          ...new Set(lines.map((l) => l.recipe).filter((r) => alternates.has(r))),
        ],
        sinkableResources: [],
        production: (f.outputs ?? []).map((o) => ({
          item: o.item,
          type: PER_MINUTE,
          amount: o.ratePerMin,
          ratio: 100,
        })),
        input: provided,
      },
    };
  });
  return { value: tabs, notes };
}
