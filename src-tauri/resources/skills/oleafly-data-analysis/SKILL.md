---
name: Data analysis
description: Take data files that live in the project through to numbers, figures, and tables in the manuscript. Picks the method with the statistics skills, runs it as a saved script rather than an inline command, writes figures to figures/ and LaTeX tables to tables/, and reports effect sizes and confidence intervals in APA style.
license: MIT
compatibility: Needs python3 on the login shell PATH with the analysis packages the method requires. Scripts run through run_command in the project directory, with a 120 second timeout and a 200 KiB output cap.
allowed-tools: run_command, read_file, write_file, create_file, replace_in_file, list_files, search_project, compile, get_log, update_todos, remember_note, load_skill, read_skill_file
metadata:
  version: "1.0.0"
  skill-author: Oleafly
  oleafly:
    tier: native
    phase: authoring
    tools:
      - run_command
      - write_file
      - create_file
      - replace_in_file
      - read_file
      - list_files
      - search_project
      - compile
      - get_log
      - update_todos
      - remember_note
      - load_skill
      - read_skill_file
---

# Data analysis

This skill connects two things the project already has: data files sitting in a folder, and
a results section that needs numbers in it. It owns the plumbing (environment, scripts,
outputs, reproducibility) and delegates the statistics to the skills that know them.

Three rules:

- **Raw data is read only.** Never overwrite, filter, or clean a file in place. Derived
  data goes to `analysis/out/`.
- **Analyses live in files, not in command lines.** Write `analysis/<name>.py` with
  `write_file`, then run it. A one-line `python3 -c` is unreviewable, unrepeatable, and
  dies with the tool call.
- **Every number in the manuscript comes from a script that is still in the repository.**
  If you cannot point at the script and the seed that produced a number, the number does
  not go in.

## 1. Check the environment, once

```sh
python3 -VV && python3 -c "import numpy, pandas; print(numpy.__version__, pandas.__version__)"
```

Then check whatever the chosen method needs, in one more call:

```sh
python3 -c "import scipy, statsmodels, matplotlib; print(scipy.__version__, statsmodels.__version__, matplotlib.__version__)"
```

Do this once per conversation and write the versions into `analysis/README.md`. Do not
re-probe before each script.

**When something is missing.** Do not install it silently. Say which package is missing and
give the user the exact line:

```sh
python3 -m pip install "scipy>=1.11" "statsmodels>=0.14.6" pandas matplotlib
```

Then let them approve the shell call, or run it themselves. If they would rather keep the
project isolated, offer a virtual environment inside the project and add it to
`.gitignore`; do not create one without asking, because every later command then has to
remember to use it.

If `python3` is missing entirely, stop. Say so, and offer to write the analysis plan and
the scripts anyway so the user can run them later.

## 2. Choose the method before writing any code

Load the skill that owns the decision. Do this first, every time. Guessing at a test and
then justifying it afterwards is how an analysis gets torn apart in review.

| Situation | Load |
|---|---|
| First contact with the data: shape, missingness, distributions, outliers | `load_skill("exploratory-data-analysis")` |
| Comparing groups, fitting a model, choosing a test, checking its assumptions, effect sizes and APA write-up | `load_skill("statistical-analysis")` |
| How many observations are needed, minimum detectable effect, a power curve for a grant | `load_skill("statistical-power")` |
| The data does not exist yet and the study still has to be laid out | `load_skill("experimental-design")` |

Those skills carry the test selection tables, the assumption checks, and the effect size
formulas. Follow them. This skill's job is to make their output land in the manuscript.

Write the plan down before running anything: the question, the test, the assumptions you
will check, the effect size you will report, and what would count as a null result. Put it
at the top of `analysis/README.md`. A plan written after seeing the p-value is not a plan.

## 3. Lay out the analysis folder

```
data/                 raw inputs, never modified
analysis/
  README.md           plan, environment, seeds, commands, how to rerun
  prepare.py          load, validate, derive; writes analysis/out/clean.csv
  analyze.py          the test or model; writes analysis/out/results.json
  figures.py          reads out/, writes figures/
  tables.py           reads out/, writes tables/*.tex
  out/                intermediates, gitignored if large
figures/              publication figures the manuscript includes
tables/               LaTeX fragments the manuscript inputs
```

Create the folders with `create_file` and the scripts with `write_file`. The skeleton for
each script, including seeding and the output contract, is in
`references/analysis-layout.md`.

Splitting into stages is not tidiness. It is what makes the 120 second cap survivable and
what lets you rerun the figures without refitting the model.

## 4. Run the scripts

```sh
python3 analysis/prepare.py
```

`run_command` runs in the project directory, so relative paths just work. One stage per
call.

**Output discipline.** The tool caps combined output at 200 KiB and truncates the rest.
Scripts must write their real results to `analysis/out/` as JSON or CSV and print a short
summary (a dozen lines at most). Then `read_file` the JSON. Printing a whole dataframe
loses the end of it.

**The 120 second cap.** A call that outlives it is killed.

- Split the work further first: a slow fit becomes fit-and-save, then a separate script
  that reads the saved model.
- Cache intermediates in `analysis/out/` and have each script skip work whose output
  already exists.
- For something genuinely long (a bootstrap with many resamples, a simulation-based power
  analysis), start it detached and poll:
  ```sh
  nohup python3 analysis/analyze.py > analysis/out/analyze.log 2>&1 &
  ```
  Then `tail -n 40 analysis/out/analyze.log` in a later turn. Tell the user you did this,
  because the process outlives the tool call.
- Reduce the work before reducing the rigour. Fewer bootstrap resamples is a defensible
  compromise you state in the write-up; a different, faster test that answers a different
  question is not.

**When a script fails.** Read the traceback, fix the script file, rerun. Do not patch
around an error with a `try` block that hides it, and do not drop rows to make an error go
away without saying so in `analysis/README.md`.

## 5. Figures

`figures.py` writes into `figures/`, one file per figure, named for what it shows
(`figures/accuracy-by-condition.pdf`, not `figures/fig1.pdf`).

- PDF for anything drawn as lines and text. It stays sharp at any zoom and LaTeX embeds it
  natively.
- PNG at 300 dpi or better only for genuine rasters (heatmaps with many cells, images).
- Never call `plt.show()`. There is no display. Always `savefig` then `close`.
- Size the figure for the column it will sit in, and set the font size so the text in the
  figure matches the document's caption size. A figure scaled down by LaTeX has unreadable
  axis labels.
- Axis labels with units, no title (the caption is the title in a paper), and a legend only
  when there is more than one series.

Then insert it in the manuscript inside a `figure` float with a caption and a label, and
`compile`. Conventions and a working matplotlib preamble are in `references/reporting.md`.
For hand-drawn diagrams rather than plotted data, use `oleafly-figure-prep` instead.

## 6. Tables

`tables.py` writes `tables/<name>.tex` containing only the `tabular`, with `booktabs`
rules and no float wrapper. The manuscript wraps it:

```latex
\begin{table}[t]
  \centering
  \caption{Accuracy by condition, with 95\% confidence intervals.}
  \label{tab:accuracy}
  \input{tables/accuracy.tex}
\end{table}
```

That split means regenerating the numbers never touches the caption, the label, or the
placement. Add `\usepackage{booktabs}` to the preamble the first time.

Round in the table generator, not by hand, and keep the rounding rule in
`analysis/README.md`. Report the same number of decimals across a column.

## 7. Write the results into the manuscript

Read `analysis/out/results.json`, then write prose.

Report, for every comparison: the test, its degrees of freedom, the test statistic, the
exact p value, the effect size, and its confidence interval. A p value on its own says
nothing about magnitude.

```
Accuracy was higher in the wider-context condition (M = 0.849, SD = 0.011) than in the
baseline (M = 0.831, SD = 0.014), t(38) = 4.52, p < .001, d = 0.62, 95% CI [0.21, 1.03].
```

APA details that reviewers do check: no leading zero on p, r, or any statistic bounded by
one; exact p to three decimals down to .001 and `p < .001` below that; italic statistic
symbols; the CI in square brackets with a comma.

`references/reporting.md` has the sentence patterns per test family (t test, ANOVA,
chi-square, correlation, regression, mixed model, Bayesian) and the corresponding effect
sizes.

Say what the result does not support as plainly as what it does. A non-significant result
is reported with the same completeness, and "no significant difference" is not evidence of
no difference: give the interval and say what it rules out.

`compile` after the edit.

## 8. Reproducibility

`analysis/README.md` is a deliverable, not a note to self. Keep it current as you go. It
carries the plan, the package versions from step 1, every random seed, the exact commands
in order, the data files with their sha256, the rounding rule, and every judgement call
(rows excluded, transformations applied, and why).

The test: someone with the repository and nothing else can rerun the analysis and get the
same numbers. The template is in `references/analysis-layout.md`.

Seed everything that draws randomness, in the script, at the top, from a constant that is
written in the README. An unseeded bootstrap gives a different confidence interval on every
run, and the manuscript will disagree with the next rerun.

## 9. Failure handling

| What happens | What to do |
|---|---|
| `python3` missing | Stop. Write the scripts and the plan, say they need Python to run. |
| A package is missing | Give the exact install line, let the user decide. Do not install silently. |
| A script times out at 120 s | Split it, cache intermediates, or run it detached and poll. |
| Output truncated | The script is printing too much. Write to `analysis/out/` and print a summary. |
| An assumption check fails | Go back to `statistical-analysis`. Use the alternative it names (non-parametric, robust, transformed) and report that you did, with the check that led there. |
| The result contradicts what the user expected | Report it as it is. Do not rerun with different options until it agrees. |
| Data has missing values | `exploratory-data-analysis` first. Never impute silently, and never drop rows without recording the count. |
| The user asks for "just the p value" | Give it, with the effect size and the interval next to it. |

## Artifacts

| Path | What goes in it |
|---|---|
| `analysis/README.md` | Plan, environment, seeds, commands, judgement calls. |
| `analysis/*.py` | The scripts. One stage each. |
| `analysis/out/` | Intermediates and `results.json`. |
| `figures/` | Publication figures, PDF or 300 dpi PNG. |
| `tables/*.tex` | `tabular` fragments with booktabs rules. |
| The manuscript's results section | The prose, with effect sizes and intervals. |

## Done when

- The method was chosen with the statistics skill and the reason is written down.
- Every number in the manuscript comes from a script in `analysis/` under a recorded seed.
- Figures are in `figures/`, referenced and captioned, and the document compiles.
- Tables are generated into `tables/` and included, not typed by hand.
- Every result reports an effect size and a confidence interval.
- `analysis/README.md` would let a stranger reproduce the numbers.

## References

- `references/analysis-layout.md`: folder layout, script skeletons, chunking around the
  120 second cap, and the `analysis/README.md` template.
- `references/reporting.md`: APA sentence patterns per test, effect sizes and their
  intervals, the booktabs table generator, and matplotlib settings for print.

Read them with `read_skill_file("oleafly-data-analysis", "references/reporting.md")`.
