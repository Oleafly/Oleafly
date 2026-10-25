# The JSON contract

Every `oleafly` command run with `--json` writes exactly one JSON object to
stdout.
Notes, progress and warnings for people go to stderr.

## The result

```json
{
  "schema_version": 1,
  "type": "result",
  "ok": true,
  "command": "build",
  "warnings": [{"code": "build.detected_main", "message": "..."}]
}
```

The command's own fields sit beside these (for example `build`, `project`,
`stats`, `bibtex`). `schema_version` changes only when a field is removed or
changes meaning; new fields can appear at any time.

## The error object

When `ok` is `false`, `error` explains why:

```json
{
  "kind": "build",
  "code": "build.failed",
  "message": "The build failed.",
  "hint": "Run `oleafly log --diagnostics` for the errors.",
  "retryable": true,
  "details": {}
}
```

- `kind` decides the exit code: `invalid_input`, `not_initialized`,
  `invalid_manifest`, `unsafe_path`, `io` (3), `missing_tool` (4), `build`
  (5), `usage` (2), `internal` (1), `auth` (6), `network` (7), `conflict` (8),
  `findings` (9), `interrupted` (130).
- `code` is stable and dotted (`project.unsafe_path`, `conflict.build_running`,
  `typst_version_missing`). Branch on it.
- `hint` is the next step, written for a person. Show it or follow it.
- `retryable` means the same command may work if you try again later.

## Events

With `--events`, progress lines come before the result:

```json
{"schema_version": 1, "type": "event", "command": "build", "event": "build_started"}
```

`oleafly watch --json` writes only events: `watching`, `build_started`,
`build_finished` (with `build`), `build_error`, `watch_error`. Each has
`ok`: the build's result on `build_finished`, `false` on the two errors, and
`true` on the rest.

## `build`

| Field | Meaning |
|---|---|
| `ok` | The PDF was written. |
| `engine` | `tectonic`, `latexmk`, `typst` or `markdown`. |
| `main_document` | The document that was built. |
| `output` | The PDF's path. |
| `copied_to` | Where `-o` copied it. |
| `previous_output` | The last good PDF when this build failed. |
| `compile_time_ms` | How long the build took. |
| `errors` | `[{kind, message, file, line}]`; `kind` is `error` or `warning`. |
| `log` | The end of the compiler log (`--log none|tail|full`). |
| `log_truncated` | The log was cut. |

## `context`

| Field | Meaning |
|---|---|
| `project` | Name, root, main document, engine, build folder. |
| `map.files` | The project's source files. |
| `map.sections` | `[{title, level, file, line}]` |
| `map.labels`, `map.bibKeys` | Labels and bibliography keys. |
| `map.unresolvedRefs`, `map.unresolvedCites` | References and citations nothing defines. |
| `map.inputGraph` | Which file includes which. |
| `unused_labels`, `unused_cites` | Labels nothing references, entries nothing cites. |
| `missing_files` | Included files, figures and bibliographies that don't exist. |
| `last_build` | The last build's result, if any. |

The `map` object uses the same field names as the app's `project_map` tool.

## `log`

| Field | Meaning |
|---|---|
| `log.text` | The log text (or its last `--tail` lines). |
| `log.truncated` | The text was cut. |
| `log.ok`, `log.engine`, `log.finished_at_ms` | The last build's result. |
| `diagnostics` | With `--diagnostics`: the errors and warnings with file and line. |
| `errors` | The last build's errors, as in `build.errors`. |
