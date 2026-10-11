# Open Factory Plan, version 0 (draft)

Open Factory Plan (OFP) is a portable JSON format for Satisfactory factory
plans, so a plan made in one tool can be opened, checked and built from in
another.

**Status: draft.** Version 0 may still change in breaking ways. Version 1 will
be the first stable one. Feedback from tool authors is welcome.

- Schema source: [`model/ofp.linkml.yaml`](../model/ofp.linkml.yaml)
- JSON Schema: [`model/generated/ofp.schema.json`](../model/generated/ofp.schema.json)
- JSON-LD context: [`model/generated/ofp.context.jsonld`](../model/generated/ofp.context.jsonld)
- Conformance fixtures: [`fixtures/`](fixtures/)
- Reference validator: `npm run ofp:validate -- plan.json` ([`src/ofp/validate.ts`](../src/ofp/validate.ts))
- Converters for SatisfactoryTools and satisfactory-logistics: `npm run ofp:convert` ([`src/interop/`](../src/interop/))

## Example

```json
{
  "ofpVersion": "0",
  "name": "Iron plates",
  "factories": [
    {
      "factoryId": "iron-plates",
      "name": "Iron plates",
      "inputs": [{ "item": "Desc_OreIron_C", "ratePerMin": 60 }],
      "lines": [
        { "recipe": "Recipe_IngotIron_C", "building": "Build_SmelterMk1_C", "machines": 2 },
        { "recipe": "Recipe_IronPlate_C", "machines": 2 }
      ],
      "outputs": [{ "item": "Desc_IronPlate_C", "ratePerMin": 40 }]
    }
  ]
}
```

## Conventions

- **Encoding:** a JSON document in UTF-8. The suggested file extension is
  `.ofp.json`.
- **Identifiers:** items, recipes and buildings use the game's class names
  (`Desc_IronPlate_C`, `Recipe_IronPlate_C`, `Build_ConstructorMk1_C`). Every
  Satisfactory tool already uses these names. Factory IDs are free text, unique
  within the plan.
- **Units:** rates are per minute. Fluids are in m³ (not litres). World
  coordinates are in metres, with x east and y south, so north is −y.
- **Unknown properties** are not allowed (the JSON Schema is closed). Ask for
  an extension mechanism rather than adding private keys.

## Structure

### Plan (the document)

| Property      | Type            | Required | Meaning                                                    |
| ------------- | --------------- | -------- | ---------------------------------------------------------- |
| `ofpVersion`  | string          | yes      | Always `"0"` for this version                              |
| `name`        | string          | yes      | Display name                                               |
| `description` | string          |          | Free-text notes                                            |
| `gameVersion` | string          |          | Game version or data bundle the plan was made against      |
| `tool`        | Tool            |          | The tool that wrote the plan: `name`, `toolVersion`, `url` |
| `factories`   | Factory[] (≥ 1) | yes      | The build sites                                            |

### Factory

| Property    | Type             | Required | Meaning                                                          |
| ----------- | ---------------- | -------- | ---------------------------------------------------------------- |
| `factoryId` | string           | yes      | Unique within the plan                                           |
| `name`      | string           | yes      | Display name                                                     |
| `location`  | `{x, y, z?}`     |          | Approximate centre, in metres                                    |
| `inputs`    | FactoryInput[]   |          | Flows that enter the factory                                     |
| `lines`     | ProductionLine[] |          | Production lines. Omit them to state targets for a tool to solve |
| `outputs`   | ItemRate[]       |          | Flows that leave the factory (its targets)                       |

An **ItemRate** is `{ "item", "ratePerMin" }`, with `ratePerMin ≥ 0`. A
**FactoryInput** is an ItemRate with an optional `fromFactory`: the
`factoryId` of the factory in this plan that supplies it. Without
`fromFactory`, the input comes from outside the plan (extraction, a train from
elsewhere).

### ProductionLine

| Property       | Type    | Required | Meaning                                                        |
| -------------- | ------- | -------- | -------------------------------------------------------------- |
| `recipe`       | string  | yes      | Recipe ID                                                      |
| `building`     | string  |          | Building ID. Defaults to the recipe's only production building |
| `machines`     | integer | yes      | Number of machines, ≥ 1                                        |
| `clockPercent` | number  |          | Clock speed of every machine, 1–250 (default 100)              |
| `somersloops`  | integer |          | Somersloops in each machine, ≥ 0 (default 0)                   |

Machines are whole: a tool that solves to 2.5 machines writes 3 machines at a
lower clock, as a player would build it.

## Semantics

Each line runs `machines × clockPercent/100 × 60/durationS` cycles per minute,
where `durationS` is the recipe's duration in seconds. Per minute it uses each
ingredient at `amount × cycles` and makes each product at
`amount × cycles × (1 + somersloops/slots)`, where `slots` is the building's
Somersloop slot count. Somersloops amplify output only, so a full set doubles
it.

For each item in a factory with lines:

- **supply** = what the lines make + the factory's inputs
- **demand** = what the lines use + the factory's outputs

Supply must cover demand. Supply above demand is allowed, with a warning.
Factories without lines are not balanced: they are targets for a tool to
solve.

Between factories, an input with `fromFactory` must name an item the supplier
lists as an output, and all inputs drawing on that output together must not
exceed its rate.

Comparisons use a relative tolerance of 10⁻⁶, so rounding in written rates is
not flagged.

## Validation rules

A validator reports issues. Each has a severity, a stable code and a JSON
Pointer to the offending value. A plan is **valid** when it has no errors.

| Code                         | Severity | Meaning                                                              |
| ---------------------------- | -------- | -------------------------------------------------------------------- |
| `schema`                     | error    | Fails the JSON Schema. Other rules are skipped                       |
| `duplicate-factory-id`       | error    | Two factories share a `factoryId`                                    |
| `unknown-item`               | error    | An input or output names an item the game data doesn't have          |
| `unknown-recipe`             | error    | A line names a recipe the game data doesn't have                     |
| `recipe-not-machine`         | error    | The recipe isn't made in a production building (Build Gun, workshop) |
| `unknown-building`           | error    | A line names a building the game data doesn't have                   |
| `building-cannot-run-recipe` | error    | The building isn't one of the recipe's production buildings          |
| `ambiguous-building`         | error    | `building` is missing, and the recipe runs in more than one building |
| `too-many-somersloops`       | error    | More Somersloops per machine than the building has slots             |
| `unknown-from-factory`       | error    | `fromFactory` names no factory in the plan                           |
| `self-supplied`              | error    | `fromFactory` names the factory itself                               |
| `not-exported`               | error    | The supplier doesn't list the item as an output                      |
| `over-drawn`                 | error    | Inputs draw more of an output than the supplier makes                |
| `unbalanced`                 | error    | A factory's supply of an item doesn't cover its demand               |
| `surplus`                    | warning  | A factory makes more of an item than it uses or outputs              |

A factory with a line-level error (an unknown recipe, building or too many
Somersloops) is not balanced, so one mistake gives one error.

The game data is the FICSIT knowledge model's bundle. A plan's `gameVersion`
is informative: v0 does not select a data version.

## Conformance

- A **validator** conforms when, for every fixture in
  [`fixtures/manifest.json`](fixtures/manifest.json), it returns the same
  `valid` result and the same error and warning codes (as multisets; order
  doesn't matter). `test/ofp.test.ts` runs the reference validator this way.
- A **writer** conforms when the plans it writes validate with no errors.
- A **reader** conforms when it accepts every valid fixture.

## RDF

The JSON-LD context turns a plan into RDF. Items, recipes and buildings become
the same IRIs as in the knowledge model's game graph
(`https://solstice035.github.io/ficsit-knowledge-model/id/<class name>`), so a
SPARQL query can join a plan with game data. Factory IDs are local, so the
reference converter (`src/ofp/rdf.ts`) puts them under the plan's own IRI.

## Not in version 0

These are deliberately left out until there's a need and a clear shape:

- extraction lines (miners, extractors and wells on specific nodes)
- power generation and the plan's power balance
- belts, pipes and logistics between factories
- recipe preferences or allowed alternates for unsolved plans
- Power Shards as items, Game Mode cost multipliers and unlock assumptions
- an extension mechanism for tool-specific data

## Licence

This specification, the schema and the fixtures are MIT.
