---
name: oleafly-experiment-loop
description: Run a series of small, recorded experiments toward one goal inside an Oleafly research task. Use when the task is to improve a metric, tune a model or analysis, compare methods, or reproduce a result. Measures a baseline first, changes one thing per run, keeps only changes that help, records every result in the task's ledger, and writes the numbers into the manuscript with run markers.
license: MIT
compatibility: Made for Oleafly research tasks, which provide start_run, wait_runs, read_run_log, ledger_append and results_table. Commands follow the task's brief (allowed, ask first, or off).
allowed-tools: start_run wait_runs run_status read_run_log cancel_run ledger_append results_table read_file write_file list_files search_project update_todos get_todos remember_note compile
metadata:
  version: "1.0.0"
  skill-author: "Oleafly"
  oleafly:
    tier: native
    phase: research
    tools:
      - start_run
      - wait_runs
      - run_status
      - read_run_log
      - cancel_run
      - ledger_append
      - results_table
      - read_file
      - write_file
      - list_files
      - search_project
      - update_todos
      - get_todos
      - remember_note
      - compile
---

# Oleafly Experiment Loop

An experiment loop answers one question with evidence: does this change move the main metric, and by how much. Every run is recorded, including the ones that fail, so the user can see what was tried and the manuscript can point at the run behind each number.

The task's brief sets the goal, the success criteria, the main metric and which direction is better, and the budget. Read it before the first run. The research record lives in the record folder the brief names (`research/<slug>/`).

## The rules

1. **One evaluation command.** Fix the command that measures the metric before the first run and keep it for every run. Write it into `plan.md`. Variation lives in committed code and config, never in a different command line or in environment variables you change between runs.
2. **Baseline first.** The first run measures the project as it is. Every later result is compared with it.
3. **One change per run.** Each run tests one hypothesis. Two changes in one run cannot tell you which one helped.
4. **Keep or discard by the brief's rule.** A change is kept when the main metric moves in the better direction by more than run-to-run noise, and the success criteria still hold. Otherwise revert it and record it as discarded.
5. **Two repair attempts, then ask.** When a run crashes, fix it at most twice in a row. After that, write what is broken into `handoff.md` and stop that line of work.
6. **Stop when it stops paying.** Stop after three runs in a row without an improvement, when the success criteria are met, or when the budget runs out.

## Running

Start runs with `start_run`, never with a blocking command:

```json
{"name": "baseline", "command": "python train.py --config configs/base.yaml", "timeout": 30}
```

`start_run` returns at once with the run id. The run keeps going after your turn; its output goes to a log and lines like `loss=0.25` or JSON objects with numbers become metrics.

Then call `wait_runs`. It returns as soon as a run finishes, with its state, exit code, last metrics and the end of its log. Never poll in a tight loop. If your turn ends while runs are still going, the task wakes you with their results.

Use `read_run_log` with `{"id": "r003", "grep": "Traceback"}` to find a failure, and `cancel_run` for a run that is clearly wasted.

## Recording

After every finished run, before the next step:

1. `ledger_append` with the hypothesis, the change, the run id, the verdict (`keep`, `discard` or `crash`) and a note on what the changed parameter did. The command and the metrics come from the run itself.
2. Update the queue in `hypotheses.md`: mark the tested idea, add the ideas the result suggests.
3. Rewrite `handoff.md`: where things stand, the best run so far, what to try next. A new session must be able to continue from it alone.

Make figures only with scripts saved under `analysis/`, so they can be run again.

## Writing results into the manuscript

Numbers in the manuscript come from `results_table`, which prints a LaTeX, Typst or Markdown table with one row per run and a run marker comment (`% run: r004`). Keep the markers. Evidence checks before review compare each marked number with the run's recorded metrics.

Never type a result by hand. If there is no run behind a number, the number does not go in.

## Before the budget ends

Write `report.md` in the record folder: the question, the baseline, what was tried, what was kept and why, the best result with its run id, and what remains open. Update `handoff.md` one last time.

## Done when

- [ ] `plan.md` names the evaluation command, and every run used it.
- [ ] A baseline run exists and every result is compared with it.
- [ ] Every run has a ledger row with a verdict.
- [ ] `handoff.md` and `report.md` describe the current state.
- [ ] Every number in the manuscript came from `results_table` and carries its run marker.

## Reference files

- `references/ledger.md` explains the ledger columns and verdicts.

Parts of this policy follow ideas from OpenResearch (MIT License, © 2026 alphaXiv).
