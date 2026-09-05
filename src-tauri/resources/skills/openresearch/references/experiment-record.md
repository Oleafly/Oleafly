# Run records

One file per run, at `research/experiments/<run-id>.md`. Named by run id so the record and
`orx logs <run-id>` always line up. Records are append only: a run that disappointed is
still evidence, and rewriting it destroys the trail.

## Template

```markdown
# Run <run-id>

- Project: <project name> (<projectId>)
- Experiment: <title> (<expId>)
- Branch: <git branch printed by create-experiment>
- Parent node: <expId of the parent, or "root">
- Started: <YYYY-MM-DD HH:MM>
- State: <running | finished | failed | cancelled>

## Hypothesis

<One sentence: what changed, what should move, and how much counts as real.>

## What changed

<The committed difference against the parent node. A short diff summary or a file list.
Not the run command: that is fixed across the tree.>

## Command

    orx exp run <expId>

## Evidence

<Lines quoted verbatim from `orx logs <run-id>`, with the log position you read them from.
Quote, do not paraphrase.>

| Metric | Value | Parent | Delta |
|---|---|---|---|
| <name> | <value> | <parent value> | <difference> |

## Reading

<What the numbers support and what they do not. Name the confound if there is one.>

## Decision

<repair | sibling | promote | stop> because <reason>.

## Next

<The concrete next command or node, or "none, question answered".>
```

## Worked example

```markdown
# Run r_8f21c

- Project: edge-sense (p_44ab)
- Experiment: wider context window (e_19d2)
- Branch: orx/e_19d2-wider-context
- Parent node: e_0001 (baseline)
- Started: 2026-09-04 14:02
- State: finished

## Hypothesis

Doubling the context window from 512 to 1024 tokens raises validation accuracy by at least
1.5 points, because the truncated inputs in the baseline lose the trailing clause.

## What changed

config/model.yaml: context_window 512 -> 1024. No other file differs from the parent.

## Command

    orx exp run e_19d2

## Evidence

From `orx logs r_8f21c`, final block:

    epoch 12 val_acc 0.8412 val_loss 0.5133
    best val_acc 0.8449 at epoch 11

| Metric | Value | Parent | Delta |
|---|---|---|---|
| best val_acc | 0.8449 | 0.8307 | +0.0142 |
| val_loss | 0.5133 | 0.5391 | -0.0258 |

## Reading

+1.42 points, just under the 1.5 the hypothesis asked for, on a single seed. One run does
not separate this from seed noise. The baseline spread across seeds is not measured yet,
so the honest statement is "consistent with the hypothesis, not yet evidence for it".

## Decision

sibling, because the round needs the seed spread before anything is promoted.

## Next

Three more children of e_0001 at the baseline setting with different seeds, then compare
the distributions.
```

## Writing records into the manuscript

When a round closes, read the records and write the numbers into the results section.

- Report the effect and its uncertainty, not a bare point estimate. If the records do not
  support an interval, say the number is from a single run.
- Cite the run id in a comment or a note next to the sentence, so the next person can find
  the log.
- Hand the statistics to `oleafly-data-analysis` when the comparison needs a test, an
  effect size, or a confidence interval. Do not invent a p-value from a table of two
  numbers.
- Compile after the edit.
