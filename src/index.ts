/**
 * Package entry point: the game data bundle, its types, and the Open Factory
 * Plan validator and RDF mapping. Data files and schemas are also exported
 * directly (see package.json `exports`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameData } from './types.ts';

export { DATA_NS, OFP_NS, VOCAB_NS } from './ns.ts';
export type * from './types.ts';
export {
  type OfpGameData,
  type OfpIssue,
  type OfpResult,
  type Plan,
  type Factory,
  type FactoryInput,
  type ItemRate,
  type ProductionLine,
  type Severity,
  lineFlows,
  validatePlan,
} from './ofp/validate.ts';
export { planToJsonLd, planToNQuads } from './ofp/rdf.ts';
export type { Conversion } from './interop/common.ts';
export {
  type SftTab,
  decodeSft,
  encodeSft,
  planFromSft,
  planToSft,
} from './interop/satisfactory-tools.ts';
export {
  type LogisticsFactoryExport,
  type LogisticsGame,
  planFromLogistics,
  planToLogistics,
} from './interop/satisfactory-logistics.ts';

/** The bundled game data (`dist/game.json`), with provenance on every record. */
export function loadGameData(): GameData {
  const path = join(import.meta.dirname, '..', 'dist', 'game.json');
  return JSON.parse(readFileSync(path, 'utf8')) as GameData;
}
