/**
 * Open Factory Plan ⇄ satisfactory-logistics (rockfactory/satisfactory-logistics).
 *
 * It exports a single factory as `{ schemaVersion: 1, kind: 'factory', factory, … }`
 * and a game backup as `{ game, factories, solvers }`. A factory has inputs
 * (from `WORLD`, by hand, or from another factory by ID) and outputs; its
 * solver works out the machines. Written from the format, not from its code.
 */
import type { Factory as OfpFactory, FactoryInput, ItemRate, Plan } from '../ofp/validate.ts';
import type { Conversion } from './common.ts';

export const WORLD_SOURCE_ID = 'WORLD';
export const MANUAL_SOURCE_ID = 'MANUAL';

export interface LogisticsFactory {
  id: string;
  name?: string | null;
  description?: string | null;
  inputs: {
    factoryId?: string | null;
    resource?: string | null;
    amount?: number | null;
    constraint?: 'input' | 'exact' | 'max';
    [other: string]: unknown;
  }[];
  outputs: {
    resource: string | null;
    amount: number | null;
    somersloops?: number | null;
    objective?: 'default' | 'max';
    [other: string]: unknown;
  }[];
  progress?: string | null;
  [other: string]: unknown;
}

export interface LogisticsSolver {
  id: string;
  isFactory?: boolean;
  request: { allowedRecipes?: string[] | null; [other: string]: unknown };
  [other: string]: unknown;
}

/** A game backup (`SerializedGame`). */
export interface LogisticsGame {
  game: {
    id: string;
    name: string;
    factoriesIds: string[];
    settings: object;
    [other: string]: unknown;
  };
  factories: LogisticsFactory[];
  solvers: LogisticsSolver[];
}

/** A single-factory export (`SerializedFactory`). */
export interface LogisticsFactoryExport {
  schemaVersion: 1;
  kind: 'factory';
  factory: LogisticsFactory;
  solver?: LogisticsSolver;
  exportedAt: string;
  gameName?: string;
}

function isFactoryExport(value: unknown): value is LogisticsFactoryExport {
  const v = value as Partial<LogisticsFactoryExport> | null;
  return !!v && v.kind === 'factory' && v.schemaVersion === 1 && typeof v.factory === 'object';
}

function isGame(value: unknown): value is LogisticsGame {
  const v = value as Partial<LogisticsGame> | null;
  return !!v && typeof v.game === 'object' && v.game !== null && Array.isArray(v.factories);
}

/** A satisfactory-logistics factory export or game backup → an OFP plan (targets only). */
export function planFromLogistics(json: unknown): Conversion<Plan> {
  let name: string;
  let factories: LogisticsFactory[];
  if (isFactoryExport(json)) {
    name = json.factory.name ?? json.gameName ?? 'satisfactory-logistics import';
    factories = [json.factory];
  } else if (isGame(json)) {
    name = json.game.name;
    const byId = new Map(json.factories.map((f) => [f.id, f]));
    // Keep the game's order; fall back to the file's order.
    const ordered = json.game.factoriesIds.flatMap((id) => byId.get(id) ?? []);
    factories = ordered.length ? ordered : json.factories;
  } else {
    throw new Error('Not a satisfactory-logistics factory export or game backup');
  }

  const notes: string[] = [];
  const ids = new Set(factories.map((f) => f.id));
  const converted = factories.map((f, i): OfpFactory => {
    const label = f.name || `Factory ${i + 1}`;
    const outputs: ItemRate[] = [];
    for (const o of f.outputs) {
      if (!o.resource || o.amount == null) continue;
      if (o.objective === 'max') {
        notes.push(`${label}: "maximise ${o.resource}" has no OFP v0 equivalent; skipped`);
        continue;
      }
      if (o.somersloops) notes.push(`${label}: Somersloops on outputs aren't in OFP v0; dropped`);
      outputs.push({ item: o.resource, ratePerMin: o.amount });
    }
    const inputs: FactoryInput[] = [];
    for (const input of f.inputs) {
      if (!input.resource || input.amount == null) continue;
      const from = input.factoryId;
      const external = !from || from === WORLD_SOURCE_ID || from === MANUAL_SOURCE_ID;
      if (!external && !ids.has(from)) {
        notes.push(
          `${label}: input from a factory not in the file (${from}); kept as a world input`,
        );
      }
      if (input.constraint && input.constraint !== 'input') {
        notes.push(`${label}: "${input.constraint}" input constraints aren't in OFP v0; dropped`);
      }
      inputs.push({
        item: input.resource,
        ratePerMin: input.amount,
        ...(!external && ids.has(from) ? { fromFactory: from } : {}),
      });
    }
    return {
      factoryId: f.id,
      name: label,
      ...(outputs.length ? { outputs } : {}),
      ...(inputs.length ? { inputs } : {}),
    };
  });
  notes.push(
    'Solver state (chosen recipes, layout, overclocks) is not imported; plans are targets only',
  );
  return {
    value: {
      ofpVersion: '0',
      name,
      tool: {
        name: 'satisfactory-logistics',
        url: 'https://github.com/rockfactory/satisfactory-logistics',
      },
      factories: converted,
    },
    notes,
  };
}

/**
 * An OFP plan → a satisfactory-logistics game backup (Games > Import). Each
 * factory keeps its inputs and outputs. When it has production lines, its
 * solver is limited to the plan's recipes, so solving reproduces the chain.
 */
export function planToLogistics(plan: Plan): Conversion<LogisticsGame> {
  const notes: string[] = [];
  const factories: LogisticsFactory[] = plan.factories.map((f) => ({
    id: f.factoryId,
    name: f.name,
    inputs: (f.inputs ?? []).map((i) => ({
      factoryId: i.fromFactory ?? WORLD_SOURCE_ID,
      resource: i.item,
      amount: i.ratePerMin,
    })),
    outputs: (f.outputs ?? []).map((o) => ({ resource: o.item, amount: o.ratePerMin })),
    progress: 'draft',
  }));
  const solvers: LogisticsSolver[] = plan.factories
    .filter((f) => f.lines?.length)
    .map((f) => ({
      id: f.factoryId,
      isFactory: true,
      request: { allowedRecipes: [...new Set((f.lines ?? []).map((l) => l.recipe))] },
    }));
  if (solvers.length) {
    notes.push(
      'Production lines become allowed recipes; satisfactory-logistics re-solves machine counts, clocks and Somersloops',
    );
  }
  if (plan.factories.some((f) => f.location)) notes.push('Factory locations are not exported');
  return {
    value: {
      game: {
        id: `ofp-${plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: plan.name,
        factoriesIds: factories.map((f) => f.id),
        settings: {},
      },
      factories,
      solvers,
    },
    notes,
  };
}
