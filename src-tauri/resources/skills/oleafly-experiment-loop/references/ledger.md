# The research ledger

`ledger.tsv` in the task's record folder has one row per result, tab separated:

| Column | What goes in it |
|---|---|
| `id` | The run id (`r004`), or `n001` for a note that has no run |
| `time` | When the row was written, ISO 8601 in UTC |
| `hypothesis` | What this run tests, in one sentence |
| `change` | The one thing that differs from the run it is compared with |
| `command` | The evaluation command (filled in from the run) |
| `metrics` | `name=value` pairs separated by `;` (filled in from the run) |
| `verdict` | `keep`, `discard` or `crash` |
| `notes` | What the changed parameter did, and anything surprising |

Write rows with `ledger_append`, not by editing the file. It fills in the command and the metrics from the run, and keeps tabs and new lines out of the cells.

## Verdicts

- `keep`: the change moved the main metric in the better direction by more than run-to-run noise, and the success criteria still hold. The change stays.
- `discard`: the change did not help, or it broke a criterion. Revert it.
- `crash`: the run did not produce a result. Say why in `notes`.

The Progress tab shows the best kept value of the main metric and its history, so a missing verdict hides a result from the user.
