/**
 * Provenance: which pinned source each record's facts come from.
 *
 * The input snapshot (`data/field-guide/`) lists its sources in `meta.json`
 * but does not tag individual records, and it must not be hand-edited. So the
 * build attaches `derivedFrom` here, from the rules below. They mirror what
 * the Field Guide data pipeline reads for each collection (its docs/DATA.md).
 */
import type {
  Building,
  Collectible,
  DataMeta,
  Item,
  Recipe,
  ResourceNode,
  Schematic,
} from './types.ts';

export interface Source {
  id: string;
  name: string;
  /** Pinned URL: a commit-pinned file, or a wiki page. */
  url: string;
  licence: string;
  /** ISO date (YYYY-MM-DD) the input bundle was built from this source. */
  retrievedAt: string;
}

/** A record with the sources its facts come from. */
export type Sourced<T> = T & { derivedFrom: string[] };

const DOCS = 'source-docs-en';
const NODES = 'source-world-resource-nodes';
const COLLECTIBLES = 'source-world-collectibles';
const FOOTPRINTS = 'source-factory-buildings';
const WIKI = 'source-satisfactory-wiki';

/** Source IDs, keyed by the file name at the end of each pinned URL in meta.json. */
const SOURCE_IDS: Record<string, string> = {
  'docs-en.json': DOCS,
  'WorldResourceNodes.json': NODES,
  'WorldCollectibles.json': COLLECTIBLES,
  'FactoryBuildings.json': FOOTPRINTS,
};

/**
 * Facts the Docs do not export, entered by hand from the Satisfactory Wiki.
 * Not pinned to a page revision (see README.md, "Provenance").
 */
const WIKI_SOURCE = {
  id: WIKI,
  name: 'Satisfactory Wiki',
  url: 'https://satisfactory.wiki.gg/',
  licence: 'CC BY-NC-SA',
};

/** Items added by hand because the Docs do not export their descriptors. */
const WIKI_ITEMS = new Set(['Desc_HardDrive_C', 'Desc_ResourceSinkCoupon_C']);
/** Buildings with a hand-entered override (Smelter: 1 Somersloop slot, Docs say 0). */
const WIKI_BUILDINGS = new Set(['Build_SmelterMk1_C']);

/** The bundle's sources, with stable IDs. Throws on a source this file doesn't know. */
export function sourcesFromMeta(meta: DataMeta): Source[] {
  const pinned = meta.sources.map((s) => {
    const file = s.url.split('/').pop() ?? '';
    const id = SOURCE_IDS[file];
    if (!id)
      throw new Error(`No source ID for ${s.url}: add it to SOURCE_IDS in src/provenance.ts`);
    return { id, name: s.name, url: s.url, licence: s.licence, retrievedAt: meta.generatedAt };
  });
  return [...pinned, { ...WIKI_SOURCE, retrievedAt: meta.generatedAt }];
}

/** The input collections, before provenance is attached. */
export interface RawGameData {
  items: Item[];
  recipes: Recipe[];
  buildings: Building[];
  schematics: Schematic[];
  resourceNodes: ResourceNode[];
  collectibles: Collectible[];
}

/** Game data with `derivedFrom` on every record and the sources they cite. */
export interface SourcedGameData {
  items: Sourced<Item>[];
  recipes: Sourced<Recipe>[];
  buildings: Sourced<Building>[];
  schematics: Sourced<Schematic>[];
  resourceNodes: Sourced<ResourceNode>[];
  collectibles: Sourced<Collectible>[];
  sources: Source[];
}

const tag = <T>(records: T[], sources: (record: T) => string[]): Sourced<T>[] =>
  records.map((r) => ({ ...r, derivedFrom: sources(r) }));

export function withProvenance(raw: RawGameData, meta: DataMeta): SourcedGameData {
  return {
    items: tag(raw.items, (i) => (WIKI_ITEMS.has(i.id) ? [WIKI] : [DOCS])),
    recipes: tag(raw.recipes, () => [DOCS]),
    buildings: tag(raw.buildings, (b) => [
      DOCS,
      ...(b.footprint ? [FOOTPRINTS] : []),
      ...(WIKI_BUILDINGS.has(b.id) ? [WIKI] : []),
    ]),
    schematics: tag(raw.schematics, () => [DOCS]),
    resourceNodes: tag(raw.resourceNodes, () => [NODES]),
    collectibles: tag(raw.collectibles, () => [COLLECTIBLES]),
    sources: sourcesFromMeta(meta),
  };
}
