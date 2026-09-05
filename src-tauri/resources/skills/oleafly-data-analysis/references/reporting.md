# Reporting results, tables, and figures

The statistics themselves belong to `statistical-analysis` and `statistical-power`. This
file is about getting their output into a manuscript correctly.

## APA formatting rules that get flagged in review

- No leading zero on any quantity that cannot exceed one: `p = .003`, `r = .52`,
  `eta squared = .18`. Keep the leading zero elsewhere: `d = 0.62`, `M = 0.849`.
- Exact p values to three decimals, down to `.001`. Below that, `p < .001`. Never `p = .000`
  and never a bare `p < .05`.
- Statistic symbols are italic (`\textit{t}`, `\textit{p}`, `\textit{M}`, `\textit{SD}`,
  `\textit{d}`, `\textit{F}`, `\textit{r}`). Greek letters are not.
- Degrees of freedom in parentheses immediately after the symbol, no space:
  `\textit{t}(38)`. Welch keeps one decimal: `\textit{t}(35.2)`.
- Confidence intervals in square brackets with a comma and no units repeated:
  `95\% CI [0.21, 1.03]`.
- Report an effect size with every test. A p value alone says nothing about magnitude.
- Report N, and report it again per group when groups are unequal.

## Sentence patterns

**Independent samples t test**

```
Accuracy was higher in the wider-context condition (M = 0.849, SD = 0.011) than in the
baseline (M = 0.831, SD = 0.014), t(38) = 4.52, p < .001, d = 0.62, 95% CI [0.21, 1.03].
```

Use Welch by default and say so when variances differ: `Welch's t(35.2) = 4.41`.

**Paired t test**

```
Latency fell after the change (M_diff = 12.4 ms, SD = 5.1), t(29) = 13.3, p < .001,
d_z = 2.43, 95% CI [1.79, 3.06].
```

Name the effect size variant. `d_z` (paired) is not comparable with `d` (independent).

**One-way ANOVA**

```
Condition affected accuracy, F(2, 57) = 6.31, p = .003, partial eta squared = .18,
90% CI [.04, .31].
```

Partial eta squared conventionally takes a 90% interval, because the F test is one sided. A
95% interval here is a common and visible error. Follow the omnibus test with the planned
contrasts and their adjusted p values, and name the adjustment.

**Chi-square**

```
Condition and outcome were associated, chi-square(1, N = 240) = 8.14, p = .004,
phi = .18, 95% CI [.06, .30].
```

Use Cramer's V rather than phi for tables larger than 2 by 2. State when any expected count
is under five and what you did about it.

**Correlation**

```
Reading time and accuracy were positively related, r(38) = .52, p < .001,
95% CI [.24, .72].
```

The interval comes from a Fisher z transform, not from the standard error of r.

**Regression**

```
The model explained 24% of the variance, R2 = .24, adjusted R2 = .23, F(3, 196) = 20.6,
p < .001. Context width predicted accuracy, b = 0.31, SE = 0.08, t(196) = 3.88, p < .001,
95% CI [0.15, 0.47], beta = .27.
```

Report unstandardised coefficients with their units, and standardised ones only when the
units are not meaningful.

**Non-parametric**

```
Scores differed between conditions, Mann-Whitney U = 312, z = -2.31, p = .021,
rank-biserial r = .28.
```

Report medians and interquartile ranges, not means, alongside a rank test.

**Mixed model**

```
Context width predicted accuracy, b = 0.28, SE = 0.07, t(41.3) = 4.02, p < .001,
95% CI [0.14, 0.42], with random intercepts by participant.
```

Name the random effects structure and the degrees of freedom method (Satterthwaite,
Kenward-Roger, or that z was used).

**Bayesian**

```
The posterior mean difference was 0.018 accuracy points, 95% credible interval
[0.009, 0.027], BF10 = 12.4.
```

Say "credible interval", not "confidence interval". ArviZ 1.x defaults to 89% intervals, so
pass `ci_prob=0.95` explicitly if that is what you are reporting, and state the width you
used.

**A null result**

```
Accuracy did not differ between conditions, t(38) = 0.41, p = .684, d = 0.13,
95% CI [-0.49, 0.75]. The interval excludes effects larger than about 0.75 standard
deviations, so a large effect is unlikely; a small one cannot be ruled out at this sample
size.
```

Never write "there was no effect". Give the interval and say what it rules out.

**Multiple comparisons**

```
p values are Holm-adjusted across the six pairwise comparisons.
```

Name the method, name how many tests, and report both raw and adjusted values when there is
room.

## Effect sizes and their intervals

| Test | Effect size | Interval |
|---|---|---|
| Independent t | Cohen's d, Hedges' g for small n | 95%, non-central t |
| Paired t | Cohen's d_z | 95% |
| One-way ANOVA | eta squared, partial eta squared, omega squared | 90% for partial eta squared |
| Chi-square 2 by 2 | phi, odds ratio | 95%, log scale for OR |
| Chi-square larger | Cramer's V | 95% |
| Correlation | r | 95%, Fisher z |
| Regression | b, beta, R2, f squared | 95% for coefficients |
| Mann-Whitney | rank-biserial r | 95%, bootstrap |
| Logistic regression | odds ratio | 95%, exponentiated |

Prefer omega squared over eta squared for small samples: eta squared is biased upward.
Hedges' g over Cohen's d below about 20 per group, for the same reason.

## The table generator

`analysis/tables.py` writes only the `tabular`, so the caption, label, and placement stay in
the manuscript and survive regeneration.

```python
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
TABLES = ROOT / "tables"
TABLES.mkdir(exist_ok=True)

df = pd.read_json(ROOT / "analysis" / "out" / "results.json").round(3)

latex = df.to_latex(
    index=False,
    escape=True,
    column_format="lrrr",
    float_format="%.3f",
)
(TABLES / "accuracy.tex").write_text(latex)
```

`to_latex` emits `\toprule`, `\midrule`, and `\bottomrule`, so `booktabs` must be in the
preamble. Read the generated file back once and check it: percent signs, underscores, and
ampersands in column names need escaping, and `escape=True` handles the cells but a
hand-written `column_format` does not check itself.

In the manuscript:

```latex
\begin{table}[t]
  \centering
  \caption{Accuracy by condition, with 95\% confidence intervals.}
  \label{tab:accuracy}
  \input{tables/accuracy.tex}
\end{table}
```

Rules: caption above the table, `\label` after the caption, no vertical rules, no double
horizontal rules, the same number of decimals down a column, and units in the column header
rather than in every cell.

## Figures for print

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams.update({
    "figure.figsize": (3.4, 2.6),   # inches, single column
    "font.size": 9,
    "axes.labelsize": 9,
    "axes.titlesize": 9,
    "legend.fontsize": 8,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.02,
    "pdf.fonttype": 42,
})

fig, ax = plt.subplots()
# ... draw ...
ax.set_xlabel("Context width (tokens)")
ax.set_ylabel("Accuracy")
fig.savefig(ROOT / "figures" / "accuracy-by-context.pdf")
plt.close(fig)
```

- `matplotlib.use("Agg")` before importing pyplot. There is no display, and without it the
  script can hang or fail.
- `pdf.fonttype: 42` embeds TrueType rather than Type 3, which several venues require.
- Size the figure for its column (about 3.4 inches single column, about 7.0 inches full
  width in a two-column layout), then include it at natural size:
  ```latex
  \includegraphics{figures/accuracy-by-context.pdf}
  ```
  Scaling with `width=\columnwidth` after sizing it correctly shrinks the fonts and undoes
  the point of setting them.
- No title on the plot. The caption is the title.
- Show uncertainty. Error bars or a band, with the caption saying what they are (standard
  error, standard deviation, or a confidence interval). An unlabelled error bar is
  unreadable.
- Do not encode a distinction by colour alone. Pair colour with a marker or a line style,
  and pick a palette that survives greyscale printing and colour vision deficiency.
- Save a PDF for line art. Use PNG at 300 dpi or more only for genuine rasters.

## The last check

Read the results section back and ask, sentence by sentence, whether each number can be
traced to `analysis/out/` and a script under a recorded seed. Anything that cannot comes
out.
