# Input data

`field-guide/` is a snapshot of the trimmed game data produced by the
[FICSIT Field Guide](https://github.com/solstice035/ficsit-field-guide) data
pipeline (`src/data/generated/*.json` at `dev` commit `37853ec`). `meta.json`
lists the pinned upstream sources and their licences; see also
[../NOTICE.md](../NOTICE.md).

Do not hand-edit these files. A follow-up moves the fetch → build → verify
pipeline into this repository, so this becomes the source of truth and the
Field Guide consumes it instead.
