# Analysis layout, scripts, and reproducibility

## Why files and not command lines

`run_command` runs one shell line in the project directory, dies after 120 seconds, and
caps combined output at 200 KiB. An analysis written as a `python3 -c` one-liner is
therefore unreviewable, unrepeatable after the chat ends, and liable to lose its own output.
A script in `analysis/` survives all three and can be read by the user.

## Folder contract

| Path | Rule |
|---|---|
| `data/` | Inputs. Read only. Never written by a script. |
| `analysis/*.py` | One stage per file. Each reads from `data/` or `analysis/out/` and writes to `analysis/out/`, `figures/`, or `tables/`. |
| `analysis/out/` | Intermediates and `results.json`. Safe to delete and regenerate. |
| `figures/` | Only files the manuscript includes. |
| `tables/` | Only `tabular` fragments the manuscript inputs. |
| `analysis/README.md` | The plan, the environment, the seeds, the commands. |

Add `analysis/out/` to `.gitignore` when the intermediates are large. Never gitignore
`figures/` or `tables/`: the manuscript needs them to compile on another machine.

## Script skeleton

```python
from pathlib import Path
import json
import numpy as np
import pandas as pd

SEED = 20260904
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "out"
OUT.mkdir(parents=True, exist_ok=True)

def main() -> None:
    rng = np.random.default_rng(SEED)
    raw = pd.read_csv(ROOT / "data" / "trials.csv")

    clean = raw.dropna(subset=["condition", "accuracy"])
    dropped = len(raw) - len(clean)

    clean.to_csv(OUT / "clean.csv", index=False)
    summary = {
        "rows_in": int(len(raw)),
        "rows_out": int(len(clean)),
        "dropped": int(dropped),
        "seed": SEED,
    }
    (OUT / "prepare.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    main()
```

Points that matter:

- Paths are derived from `__file__`, so the script works whether it is run from the project
  root or anywhere else.
- The seed is a module constant, written once, and it goes into `analysis/README.md`.
- The real output is a file. `print` emits a short summary, not the data.
- Row counts before and after any filtering are recorded, so a silent drop is impossible.

## Stage boundaries

Split at points where the expensive thing is done and the result is worth keeping:

| Stage | Reads | Writes | Typically expensive |
|---|---|---|---|
| `prepare.py` | `data/` | `out/clean.csv`, `out/prepare.json` | rarely |
| `analyze.py` | `out/clean.csv` | `out/results.json`, `out/model.pkl` | yes |
| `figures.py` | `out/` | `figures/*.pdf` | no |
| `tables.py` | `out/results.json` | `tables/*.tex` | no |

The split means a caption change or a colour change reruns a fast script, not the model.

Add a skip guard to a slow stage so a rerun is cheap:

```python
target = OUT / "results.json"
if target.exists() and not FORCE:
    print(f"{target.name} exists, skipping. Set FORCE=1 to recompute.")
    return
```

## Living with the 120 second cap

In order of preference:

1. **Split the stage.** Fit and save, then load and summarise.
2. **Cache.** Skip guards as above.
3. **Reduce the workload honestly.** Fewer bootstrap resamples, a coarser grid in a
   simulation power analysis. Record the number used in `analysis/README.md` and say it in
   the write-up. Do not silently change the method to a faster one.
4. **Run detached and poll.**
   ```sh
   nohup python3 analysis/analyze.py > analysis/out/analyze.log 2>&1 &
   ```
   Then in a later turn:
   ```sh
   tail -n 40 analysis/out/analyze.log
   ```
   Say out loud that a process is running in the background, and check it before drawing
   any conclusion. A detached process is not affected by stopping the chat.

Long simulations should print progress with a flush so the log is useful while it runs:

```python
print(f"resample {i}/{n}", flush=True)
```

## Output discipline

- Real results go to `analysis/out/results.json` in a shape you will read back with
  `read_file`. Flat keys, plain numbers, no numpy types (`float(x)`, `int(n)`).
- `print` a summary of at most a dozen lines.
- Never print a whole dataframe. `df.head()` for a shape check, and the file for the rest.
- If a call comes back marked truncated, that is a script problem, not a tool problem.

## `analysis/README.md` template

```markdown
# Analysis

## Question and plan

<The question. The test and why it, not the alternatives. The assumptions to be checked.
The effect size to be reported. What would count as a null result.>
Written before the analysis was run.

## Data

| File | Rows | sha256 | Notes |
|---|---|---|---|
| data/trials.csv | 240 | a91f... | one row per trial, 40 participants |

## Environment

Recorded <date>, from the login shell.

    python 3.12.4
    numpy 2.1.3
    pandas 2.2.3
    scipy 1.14.1
    statsmodels 0.14.6
    matplotlib 3.9.2

## Seeds

    SEED = 20260904   # analysis/prepare.py, analysis/analyze.py

## How to rerun

    python3 analysis/prepare.py
    python3 analysis/analyze.py
    python3 analysis/figures.py
    python3 analysis/tables.py

Then compile the project.

## Judgement calls

- Dropped 6 trials with a missing accuracy value (2.5% of 240). Listed in
  analysis/out/prepare.json. Not imputed.
- Levene's test rejected equal variances, so Welch's t test was used instead of Student's.
- Bootstrap CI uses 10000 resamples. 100000 exceeded the 120 second tool limit.
- All values rounded to three decimals in tables; p values to three, or reported as
  p < .001.

## Outputs

| Output | Produced by | Used in |
|---|---|---|
| figures/accuracy-by-condition.pdf | analysis/figures.py | Figure 2 |
| tables/accuracy.tex | analysis/tables.py | Table 1 |
| analysis/out/results.json | analysis/analyze.py | Results section |
```

Compute the hashes with `shasum -a 256 data/*.csv` (macOS and Linux). If the data changes,
the hash changes, and that is the signal that the numbers need regenerating.

## What not to do

- Do not clean data by editing the file in `data/`.
- Do not run an analysis whose script you deleted afterwards.
- Do not let a figure or table in the manuscript come from a number typed by hand.
- Do not leave an unseeded random process anywhere in the pipeline.
- Do not report a result from a run whose script has since changed.
