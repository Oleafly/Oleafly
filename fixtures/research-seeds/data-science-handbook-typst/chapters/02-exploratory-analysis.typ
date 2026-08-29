#import "../lib/style.typ": *

= Exploratory Analysis and Distributional Summaries

Exploratory analysis has a reputation as the informal phase of a project, the
part done before the real work begins. That reading is a mistake with
consequences. Every summary is an estimator, every estimator has a variance and
a breakdown point, and a plot is a hypothesis about which features of a
distribution matter. This chapter treats description with the same seriousness
as inference, because descriptive choices propagate: the bin width that hides a
second mode also hides the feature that would have justified a mixture model.

== A summary is an estimator with a failure mode

The mean is the most efficient estimator of location for Gaussian data and one
of the worst for anything else. What distinguishes location estimators in
practice is not efficiency at the ideal model but behaviour under
contamination @huber1964robust.

#definition("Breakdown point")[
  Let $hat(theta)_n$ be an estimator computed on a sample of size $n$. Its
  finite-sample _breakdown point_ is the smallest fraction $epsilon^*$ of
  observations that, when replaced by arbitrary values, can drive
  $|hat(theta)_n|$ beyond any bound:
  $ epsilon^*_n = min_(m) { m/n : sup_(z_1, dots, z_m) |hat(theta)_n (x_((m)), z)| = infinity }. $
]

#theorem("Breakdown of the mean and the median")[
  The sample mean has $epsilon^* = 1 slash n$, which tends to zero. The sample
  median has $epsilon^* = floor((n - 1) slash 2) slash n$, which tends to one
  half, the maximum attainable by any translation-equivariant estimator.
]

One corrupted row is enough to move a mean anywhere. This is not a hypothetical
about adversaries; it is a statement about sentinel values. A latency column
where a timeout writes 2147483647 will report a mean in the millions of years,
and the analyst who reaches for `df.describe()` will see it. The analyst who
reaches for a group-level mean inside a feature transformation will not.

@tab:estimators sets out the tradeoff. The efficiency column gives the
asymptotic relative efficiency against the mean under a Gaussian model, so the
cost of robustness is read directly: the median buys a breakdown point of one
half at the price of roughly a third of the effective sample size.

#figure(
  book-table(
    columns: (1fr, auto, auto, auto),
    align: (left, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Estimator*], [*Breakdown $epsilon^*$*], [*Gaussian ARE*], [*Equivariant*],
    ),
    table.hline(stroke: 0.5pt),
    [Sample mean], [0.00], [1.000], [Yes],
    [10 percent trimmed mean], [0.10], [0.968], [Yes],
    [25 percent trimmed mean], [0.25], [0.914], [Yes],
    [Median], [0.50], [0.637], [Yes],
    [Huber $M$, $k = 1.345$], [0.50], [0.950], [Yes],
    [Standard deviation], [0.00], [1.000], [Scale],
    [Median absolute deviation], [0.50], [0.367], [Scale],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Location and scale estimators by breakdown point and asymptotic
  relative efficiency under a Gaussian model. The Huber estimator with the
  standard tuning constant is the usual default: it gives up five percent of
  efficiency and gains the full breakdown point.],
) <tab:estimators>

The following helper is what we put at the top of every exploratory notebook. It
reports the robust and the classical summary side by side, on the argument that
a large discrepancy between them is itself the finding.

```python
import numpy as np
from scipy import stats


def dual_summary(x, sentinel_values=(-1, 2147483647)):
    x = np.asarray(x, dtype=float)
    flagged = np.isin(x, sentinel_values) | ~np.isfinite(x)
    clean = x[~flagged]
    if clean.size < 8:
        raise ValueError(f"only {clean.size} usable observations after sentinel removal")

    mad = stats.median_abs_deviation(clean, scale="normal")
    return {
        "n": int(clean.size),
        "flagged_fraction": float(flagged.mean()),
        "mean": float(clean.mean()),
        "median": float(np.median(clean)),
        "sd": float(clean.std(ddof=1)),
        "mad_normal": float(mad),
        "sd_over_mad": float(clean.std(ddof=1) / mad) if mad > 0 else np.inf,
        "skew": float(stats.skew(clean)),
    }
```

#remark[
  The `sd_over_mad` ratio is the diagnostic worth watching. Under a Gaussian
  model it sits near 1.0. Values above 2 indicate heavy tails or residual
  contamination, and values above 5 almost always mean a sentinel survived the
  filter. We have never seen a value above 10 that was not a data defect.
]

== Binning is a density estimate

A histogram looks like a display of the data. It is a density estimator with a
smoothing parameter, and the parameter is the bin width. Too narrow and the
estimate is dominated by sampling noise; too wide and genuine structure is
averaged away. The Freedman-Diaconis rule chooses the width that minimises the
asymptotic mean integrated squared error using a robust scale
estimate @freedman1981histogram:

$ h_"FD" = 2 dot ("IQR"(x)) / (n^(1 slash 3)). $ <eq:fd>

@eq:fd is deliberately conservative on the tails, because the interquartile
range does not respond to the outliers that would inflate a rule built on the
standard deviation. @fig:histogram applies it to the response-time distribution
from our internal request log.

#figure(
  chart(9.6cm, 4.4cm, {
    let w = 9.6cm
    let h = 4.4cm
    let counts = (2, 9, 24, 46, 71, 88, 82, 63, 44, 29, 18, 11, 6, 3)
    let bar = w / 14
    gridlines-y(w, h, 5)
    for (i, c) in counts.enumerate() {
      let top = py(c, 0, 100, h)
      place(
        dx: bar * i,
        dy: top,
        rect(width: bar, height: h - top, fill: series-a.lighten(66%), stroke: 0.4pt + series-a),
      )
    }
    let density = (
      (0, 1), (20, 7), (40, 22), (60, 47), (80, 72), (100, 86), (120, 84),
      (140, 66), (160, 46), (180, 30), (200, 19), (220, 11), (240, 6),
      (260, 3), (280, 1),
    )
    place(polyline(
      density.map(point => (px(point.at(0) + 10, 0, 280, w), py(point.at(1), 0, 100, h))),
      stroke: 1.4pt + series-b,
    ))
    axes(w, h)
    for value in (0, 25, 50, 75, 100) { ytick(py(value, 0, 100, h), [#value]) }
    for value in (0, 70, 140, 210, 280) { xtick(px(value, 0, 280, w), h, [#value]) }
    xlabel(w, h, [Response time (ms)])
    ylabel(h, [Count per bin])
    place(dx: 5.9cm, dy: 0.15cm, box(width: 4.2cm, align(left, {
      swatch(series-a.lighten(50%), [Histogram, 20 ms bins])
      linebreak()
      swatch(series-b, [Kernel estimate, $b = 14$])
    })))
  }),
  caption: [Response times for 496 sampled requests. The Freedman-Diaconis width
  is 20 ms. The kernel estimate agrees on the mode near 100 ms and disagrees on
  the shoulder near 140 ms, which is where a second service tier enters.],
) <fig:histogram>

The shoulder in @fig:histogram is the interesting feature, and it is exactly the
feature a doubled bin width erases. We rebinned this data at 40 ms as a check
and the distribution became a clean unimodal shape with no shoulder at all. The
resulting summary would have been defensible, reproducible, and wrong about the
one thing the analysis was commissioned to find.

== The empirical distribution function

Quantile-based description avoids the bin-width problem entirely. The empirical
distribution function

$ hat(F)_n (t) = 1/n sum_(i=1)^n bb(1){x_i <= t} $ <eq:ecdf>

is a consistent estimator of $F$ at every point, and it comes with a
distribution-free uniform band. The Dvoretzky-Kiefer-Wolfowitz inequality with
the tight constant gives, for all $epsilon > 0$,

$ Pr(sup_t |hat(F)_n (t) - F(t)| > epsilon) <= 2 exp(-2 n epsilon^2), $ <eq:dkw>

so a $1 - alpha$ uniform band has half-width $epsilon_n = sqrt(log(2 slash alpha) slash (2n))$.
@fig:ecdf draws the estimate with its 95 percent band for the same data.

#figure(
  chart(9.6cm, 4.4cm, {
    let w = 9.6cm
    let h = 4.4cm
    let quantiles = (
      (0, 0.000), (30, 0.010), (50, 0.040), (70, 0.130), (90, 0.290),
      (110, 0.480), (130, 0.640), (150, 0.760), (170, 0.845), (190, 0.900),
      (210, 0.938), (230, 0.962), (250, 0.979), (270, 0.992), (280, 1.000),
    )
    let steps = ()
    for (i, point) in quantiles.enumerate() {
      if i > 0 {
        steps.push((px(point.at(0), 0, 280, w), py(quantiles.at(i - 1).at(1), 0, 1, h)))
      }
      steps.push((px(point.at(0), 0, 280, w), py(point.at(1), 0, 1, h)))
    }
    gridlines-y(w, h, 4)
    let band = 0.061
    place(polyline(
      quantiles.map(point => (
        px(point.at(0), 0, 280, w),
        py(calc.min(1.0, point.at(1) + band), 0, 1, h),
      )),
      stroke: (paint: series-c, thickness: 0.7pt, dash: "dashed"),
    ))
    place(polyline(
      quantiles.map(point => (
        px(point.at(0), 0, 280, w),
        py(calc.max(0.0, point.at(1) - band), 0, 1, h),
      )),
      stroke: (paint: series-c, thickness: 0.7pt, dash: "dashed"),
    ))
    place(polyline(steps, stroke: 1.3pt + series-a))
    let median-x = px(133, 0, 280, w)
    place(dx: median-x, dy: py(0.5, 0, 1, h), line(angle: 90deg, length: h - py(0.5, 0, 1, h), stroke: (paint: luma(45%), thickness: 0.6pt, dash: "dotted")))
    marker(median-x, py(0.5, 0, 1, h), series-b, radius: 2.2pt)
    axes(w, h)
    for value in (0.0, 0.25, 0.5, 0.75, 1.0) { ytick(py(value, 0, 1, h), [#value]) }
    for value in (0, 70, 140, 210, 280) { xtick(px(value, 0, 280, w), h, [#value]) }
    xlabel(w, h, [Response time (ms)])
    ylabel(h, [$hat(F)_n (t)$])
    place(dx: 6.5cm, dy: 2.9cm, box(width: 3.5cm, align(left, {
      swatch(series-a, [Empirical CDF])
      linebreak()
      swatch(series-c, [95 percent DKW band])
    })))
  }),
  caption: [Empirical distribution function with a uniform 95 percent band of
  half-width 0.061 from @eq:dkw at $n = 496$. The marked point is the median at
  133 ms. The band is uniform over $t$, so any monotone summary read from the
  curve inherits it.],
) <fig:ecdf>

The band in @fig:ecdf is worth more than a pointwise interval because it is
simultaneous. Any statement of the form "the ninetieth percentile lies below 200
milliseconds" can be read off the picture with a valid 95 percent guarantee, and
so can every other such statement about the same curve, without a multiplicity
correction. Pointwise intervals do not have this property, and reporting a table
of pointwise quantile intervals invites exactly the comparison they cannot
support.

== Group comparison before modelling

@tab:groups compares the three service tiers directly. The columns are chosen so
that a reader can see both the central tendency and the tail, because in latency
work the tail is the service level objective and the centre is not.

#figure(
  book-table(
    columns: (auto, auto, auto, auto, auto, auto),
    align: (left, right, right, right, right, right),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Tier*], [*$n$*], [*Median (ms)*], [*IQR (ms)*], [*p95 (ms)*], [*Timeouts*],
    ),
    table.hline(stroke: 0.5pt),
    [Standard], [312], [118], [64], [214], [0.6 percent],
    [Priority], [131], [96], [41], [163], [0.0 percent],
    [Batch], [53], [187], [142], [412], [5.7 percent],
    table.hline(stroke: 0.5pt),
    [Pooled], [496], [133], [78], [246], [1.0 percent],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Response time by service tier. The pooled median sits between the
  Standard and Batch medians and describes no tier accurately, which is the
  usual signature of a mixture that should be modelled with the tier as a
  covariate.],
) <tab:groups>

Note the pooled row. Its median of 133 ms is the number that would appear in a
dashboard, and it corresponds to no tier. The Batch tier carries a timeout rate
almost ten times the Standard tier on a fifth of the volume, so it contributes
little to the pooled median and dominates the pooled tail. Any alert threshold
set from the pooled distribution will fire late for Batch and never for
Priority. This is not a subtle statistical point, but it survives into
production with remarkable regularity.

== Missingness has structure

Missing values are usually reported as a per-column rate, which discards the
information that matters. What determines whether a complete-case analysis is
defensible is not how often each column is missing but which columns go missing
together. @fig:missing shows the co-occurrence structure for the request log.

#figure(
  box(width: 11.0cm, height: 4.6cm, {
    let cols = ("device", "region", "tier", "referrer", "latency")
    let patterns = (
      (0, 0, 0, 0, 0, 71.2),
      (0, 0, 0, 1, 0, 14.8),
      (1, 0, 0, 1, 0, 6.3),
      (0, 1, 0, 1, 0, 3.9),
      (1, 1, 0, 1, 1, 2.6),
      (1, 1, 1, 1, 1, 1.2),
    )
    let cw = 1.35cm
    let rh = 0.5cm
    let x0 = 2.1cm
    let y0 = 0.85cm
    for (j, name) in cols.enumerate() {
      place(dx: x0 + cw * j, dy: 0.3cm, box(width: cw, align(center, text(size: 7.5pt, name))))
    }
    for (i, row) in patterns.enumerate() {
      place(dx: 0cm, dy: y0 + rh * i + 0.12cm, box(width: 2.0cm, align(right, text(size: 7.5pt)[Pattern #(i + 1)])))
      for j in range(5) {
        let missing = row.at(j) == 1
        place(
          dx: x0 + cw * j,
          dy: y0 + rh * i,
          rect(
            width: cw,
            height: rh,
            fill: if missing { series-b.lighten(35%) } else { luma(93%) },
            stroke: 0.4pt + white,
          ),
        )
      }
      let share = row.at(5)
      place(
        dx: x0 + cw * 5 + 0.15cm,
        dy: y0 + rh * i + 0.09cm,
        rect(width: 2.4cm * share / 80.0, height: rh - 0.18cm, fill: series-a.lighten(40%), stroke: none),
      )
      place(
        dx: x0 + cw * 5 + 0.15cm + 2.4cm * share / 80.0 + 0.08cm,
        dy: y0 + rh * i + 0.1cm,
        text(size: 7pt)[#share%],
      )
    }
    place(dx: x0 + cw * 5 + 0.15cm, dy: 0.3cm, text(size: 7.5pt)[share of rows])
    place(dx: 0cm, dy: 4.1cm, align(left, {
      box(width: 0.35cm, height: 0.22cm, fill: series-b.lighten(35%))
      text(size: 7.5pt)[ missing #h(10pt)]
      box(width: 0.35cm, height: 0.22cm, fill: luma(93%))
      text(size: 7.5pt)[ observed]
    }))
  }),
  caption: [Missingness patterns in the request log, ordered by frequency.
  Referrer is missing in every incomplete pattern, and device and region go
  missing together. A complete-case analysis retains 71 percent of rows and
  removes a non-random 29 percent.],
) <fig:missing>

The picture makes two things immediate that a column-wise table hides. First,
`referrer` is missing in every incomplete pattern, so it accounts for the whole
of the complete-case loss on its own. Second, `device` and `region` are missing
together, which points at a single upstream enrichment step rather than two
independent failures. That is a debugging lead, and it came out of a description
rather than a model.

```python
def missingness_patterns(frame, columns, min_share=0.005):
    indicator = frame[columns].isna()
    signature = indicator.apply(lambda row: tuple(row), axis=1)
    counts = signature.value_counts(normalize=True)
    counts = counts[counts >= min_share]

    report = []
    for pattern, share in counts.items():
        report.append({
            "pattern": dict(zip(columns, pattern)),
            "share": round(float(share), 4),
            "n_missing": int(sum(pattern)),
        })
    report.sort(key=lambda entry: -entry["share"])
    return report
```

A final caution on the resampling that usually accompanies this stage. The
bootstrap @efron1979bootstrap gives honest intervals for the summaries in
@tab:groups only if the resampling unit matches the sampling unit. Resampling
rows when the design sampled sessions will understate the variance by roughly
the design effect from Chapter 1, and the understatement grows with the number
of requests per session. When in doubt, resample the cluster and accept the
wider interval, because the alternative is an interval that is narrow and
wrong @tukey1977eda.
