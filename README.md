# FICSIT knowledge model

An open data model for [Satisfactory](https://www.satisfactorygame.com/) game
data. One [LinkML](https://linkml.io) schema generates every view of the same
data:

- a **JSON Schema** that validates the data as plain JSON
- **SQL tables**, built into a SQLite database
- a **JSON-LD context** that turns the same JSON into an **RDF knowledge graph**
- **SHACL shapes** that validate the graph

It started as a spike for the [FICSIT Field Guide](https://github.com/solstice035/ficsit-field-guide)
and is the foundation for **Open Factory Plan**, a portable plan format so
factory plans can move between Satisfactory tools.

> Community-sourced from the Satisfactory Wiki and open-source projects; may lag
> game patches; verify in game. Not affiliated with or endorsed by Coffee Stain
> Studios. See [NOTICE.md](NOTICE.md) for sources and licences.

## Quick start

Needs Node 22.22 or later. Regenerating the model also needs
[uv](https://docs.astral.sh/uv/).

```sh
npm install
npm test        # JSON Schema, SHACL and the SQL ↔ SPARQL example queries
npm run build   # dist/game.sqlite, dist/game.ttl, dist/NOTICE.md
npm run gen     # regenerate model/generated/ from the LinkML schema (needs uv)
```

## How it fits together

```
model/ficsit.linkml.yaml               ← single source of truth (LinkML)
  │  npm run gen  (pinned LinkML 1.12.0)
  ├── generated/ficsit.schema.json     JSON Schema: validates data/field-guide/*.json
  ├── generated/ficsit.sql             SQL DDL: tables for game.sqlite
  ├── generated/ficsit.context.jsonld  JSON-LD context: turns the same JSON into RDF
  └── generated/ficsit.shacl.ttl       SHACL shapes: validates the RDF

data/field-guide/*.json  ──  npm run build  ──►  dist/game.sqlite
                                                 dist/game.ttl
                                                 dist/NOTICE.md
```

- `model/generated/` is committed and **generated**: never hand-edit it. Change
  the YAML and run `npm run gen`. CI regenerates it and fails on drift.
- `data/field-guide/` is the input snapshot (see [data/README.md](data/README.md)).
- `dist/` is a git-ignored build output.

## Identifiers

| Kind                   | IRI                                                                         |
| ---------------------- | --------------------------------------------------------------------------- |
| Vocabulary (`ficsit:`) | `https://solstice035.github.io/ficsit-knowledge-model/vocab#`               |
| Data (`fgd:`)          | `https://solstice035.github.io/ficsit-knowledge-model/id/<game class name>` |

Data IRIs keep the game's class names, so `fgd:Desc_IronPlate_C` is Iron Plate.
Every Satisfactory tool already uses these names, which is what makes the data
linkable across tools. The URLs do not resolve yet.

## Example queries

`model/queries/` holds six questions, each written in SQL (`.sql`) and SPARQL
(`.rq`). `test/graph.test.ts` runs both and checks they agree.

| Query | Question                                                                             |
| ----- | ------------------------------------------------------------------------------------ |
| Q1    | Every item in the standard Heavy Modular Frame chain, and the earliest tier for each |
| Q2    | Wire alternates that use less Copper Ore than the standard recipe                    |
| Q3    | Every item that transitively depends on Raw Quartz                                   |
| Q4    | Manufacturer recipes ranked by energy per item (all draw 55 MW, so MW alone is flat) |
| Q5    | Nodes within 1 km of a base at (-1,640 m, -330 m) that feed the Steel Ingot chain    |
| Q6    | Records with facts from a non-commercial (CC BY-NC) source                           |

Both views first add the same derived relation, `madeFrom` (`derive.sql` /
`derive.ru`): product made from ingredient, over standard machine recipes, with
raw resources as leaves.

Units: rates per minute, fluids in m³, power in MW, durations in seconds, world
coordinates in metres (x east, y south; north is −y).

## Provenance

Every record (item, recipe, building, schematic, resource node, collectible)
has a required `derivedFrom` list naming the sources its facts come from
(`prov:wasDerivedFrom` in RDF, `<Class>_derivedFrom` tables in SQLite). Each
`Source` has an ID, a name, a pinned URL, a licence and a retrieval date.

| Source ID                     | Cited by                                                      |
| ----------------------------- | ------------------------------------------------------------- |
| `source-docs-en`              | Items, recipes, buildings, schematics                         |
| `source-factory-buildings`    | Buildings with a clearance box (`footprint`)                  |
| `source-world-resource-nodes` | Resource nodes, wells and geysers                             |
| `source-world-collectibles`   | Collectibles                                                  |
| `source-satisfactory-wiki`    | Hard Drive and FICSIT Coupon items; the Smelter's sloop slots |

The input snapshot doesn't tag records itself, so `src/provenance.ts` attaches
`derivedFrom` at build time from `meta.json` and the rules above. Limits, until
the data pipeline moves here:

- `retrievedAt` is the date the input bundle was built (`meta.json`
  `generatedAt`). The commit-pinned URLs fix the content regardless.
- Wiki facts point at the wiki, not at a pinned page revision.

## Known data gaps

SQLite's foreign-key check and SHACL independently report the same dangling
references, and nothing else. The counts are pinned in the tests, so any new gap
fails CI.

| Gap                         | Count | Cause                                                               |
| --------------------------- | ----- | ------------------------------------------------------------------- |
| Recipe product → Item       | 537   | Build Gun recipes produce buildable descriptors, which aren't items |
| Schematic → dependsOn       | 104   | Points at schematics the input build trims out                      |
| Schematic → unlocked recipe | 35    | Points at recipes the input build trims out                         |
| Resource node → Item        | 31    | Geysers use the pseudo-resource `geothermal`                        |

## Design notes

- **`Ingredient` and `Product` subclasses.** `gen-sqlddl` otherwise stores both
  in one `ItemAmount` table with no role column. The JSON is unchanged.
- **Inlining is set per class** with `slot_usage`. A slot inlined in one class
  and referenced in another otherwise confuses `gen-shacl`.
- **Source URLs are IRIs.** `gen-jsonld-context` types `uri` slots as
  `xsd:anyURI` literals but `gen-shacl` expects IRIs, so the build emits
  `schema:url` as an IRI.
- **Numbers are `double`.** `xsd:float` is 32-bit in SPARQL engines and loses
  precision on world coordinates.
- **Oxigraph 0.5.11 arithmetic.** It groups chained `-` and `/` from the right
  (`8 - 4 - 2` = 6). Every `.rq` file brackets chained arithmetic, and a test
  fails once upstream fixes it so the workaround can be dropped.
- **Tooling.** LinkML is Python, so only regeneration needs `uv`. Building and
  testing are pure Node: `node:sqlite` (built in), `jsonld`, `oxigraph` (WASM)
  and `rdf-validate-shacl`.

## Roadmap

1. ~~Provenance on every record (source, pinned URL, retrieval date, licence).~~
   Done; see [Provenance](#provenance).
2. Open Factory Plan v0: a plan schema, validator and conformance fixtures.
3. Move the data pipeline here, so the Field Guide consumes this repository.
4. Publish an npm package and browsable data (Datasette Lite), plus the RDF
   dump at stable URLs.
5. Importers and exporters for other open-source planners.

## Contributing

Branches are `main` ← `dev` ← `feature/*`; open pull requests into `dev`. See
[CLAUDE.md](CLAUDE.md) for commands and repository rules.

## Licence

Code, schema and queries: [MIT](LICENSE). Game data has its own licences; see
[NOTICE.md](NOTICE.md).
