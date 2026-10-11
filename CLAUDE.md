# CLAUDE.md: FICSIT knowledge model

Open data model for Satisfactory game data. One LinkML schema
(`model/ficsit.linkml.yaml`) generates JSON Schema, SQL DDL, a JSON-LD context
and SHACL. Read `README.md` first.

## Commands

- `npm test`: JSON Schema, SHACL, and the SQL ↔ SPARQL example queries (Vitest, Node)
- `npm run lint`, `npm run typecheck`, `npm run format:check`
- `npm run build`: writes `dist/game.sqlite`, `dist/game.ttl` and `dist/NOTICE.md`
- `npm run gen`: regenerates `model/generated/` from the schema (needs `uv`)

Done = `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` all green.

## Rules

- `model/generated/` is **generated**: never hand-edit it. Change the YAML and
  run `npm run gen`. CI regenerates it and fails on drift.
- `data/field-guide/` is an input snapshot: never hand-edit it (see `data/README.md`).
- Every SPARQL query brackets chained arithmetic: Oxigraph 0.5.11 groups `-`
  and `/` from the right.
- Pin dependency versions exactly. LinkML is pinned in `scripts/gen.sh`.
- Units: rates are **per minute**; fluids in **m³**; power in MW; world
  coordinates in **metres** (x east, y south, so north is −y).
- Game IDs keep the game's class names (`Desc_IronPlate_C`, `Recipe_IronPlate_C`).
- Sources: public and open-source only (the Satisfactory Wiki and open-source
  repos). No game-file extraction or datamining. Attribute every source in
  `NOTICE.md`, and keep the caveat on every published artefact.
- British English in prose; game names keep the game's spelling.

## Git

- Branches: `main` ← `dev` ← `feature/*`. Open PRs into `dev`.
- Commit format: `{gitmoji} {scope}: {description}`.
- Never push `main` or `dev` directly. Merging is Nick's.
