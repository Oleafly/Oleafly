#import "../lib/style.typ": *

= Communicating Uncertainty and Monitoring Deployments

The last stage of a modelling project is the one most often skipped: converting a
fitted function into a number that a decision process can consume without being
misled. A ranking model that is well ordered and badly calibrated will support a
threshold decision poorly, and a point prediction with no interval will be read
as though it had no error at all. This chapter covers calibration, prediction
intervals with a coverage guarantee, and the monitoring that keeps both honest
after release.

== Discrimination is not calibration

#definition("Calibration")[
  A probabilistic classifier $hat(p): cal(X) -> [0, 1]$ is _calibrated_ if
  $ Pr(Y = 1 | hat(p)(X) = q) = q quad "for all" q in [0, 1] "in the support of" hat(p)(X). $
  Calibration constrains the level of the predictions. Discrimination, measured
  by AUC, constrains only their order, and is invariant to any strictly
  increasing transformation of $hat(p)$.
]

Because AUC is invariant to monotone transformation, a model can achieve any AUC
whatsoever while being arbitrarily miscalibrated. This is not a corner case. Every
boosted ensemble trained with early stopping is systematically overconfident at
both extremes, and any model trained on a rebalanced sample is miscalibrated by
construction, by an amount equal to the log odds of the resampling ratio.

The proper scoring rules separate the two properties. The Brier score
@brier1950verification is the mean squared error of the probability forecast, and
Murphy's decomposition splits it into interpretable parts @murphy1973vector:

$ "BS" = 1/n sum_(i=1)^n (hat(p)_i - y_i)^2
       = underbrace(1/n sum_(b) n_b (macron(p)_b - macron(y)_b)^2, "reliability")
       - underbrace(1/n sum_(b) n_b (macron(y)_b - macron(y))^2, "resolution")
       + underbrace(macron(y)(1 - macron(y)), "uncertainty"). $ <eq:brier>

Reliability is a calibration penalty and is minimised at zero. Resolution rewards
separating the outcome, so a model that always predicts the base rate has zero
reliability and zero resolution. Uncertainty depends only on the data. Reporting
all three is more informative than reporting any single number, and the
decomposition is why a proper scoring rule cannot be gamed by shading predictions
toward the base rate @gneiting2007scoring.

@fig:calib shows the reliability diagram for the churn ensemble before and after
isotonic recalibration.

#figure(
  chart(8.4cm, 4.6cm, {
    let w = 8.4cm
    let h = 4.6cm
    let raw = (
      (0.03, 0.011), (0.09, 0.052), (0.17, 0.118), (0.26, 0.201),
      (0.36, 0.302), (0.47, 0.419), (0.58, 0.548), (0.69, 0.681),
      (0.79, 0.804), (0.89, 0.915), (0.96, 0.978),
    )
    let fixed = (
      (0.03, 0.028), (0.09, 0.087), (0.17, 0.164), (0.26, 0.258),
      (0.36, 0.354), (0.47, 0.472), (0.58, 0.586), (0.69, 0.694),
      (0.79, 0.788), (0.89, 0.884), (0.96, 0.955),
    )
    gridlines-y(w, h, 4)
    place(polyline(
      ((px(0, 0, 1, w), py(0, 0, 1, h)), (px(1, 0, 1, w), py(1, 0, 1, h))),
      stroke: (paint: luma(50%), thickness: 0.7pt, dash: "dashed"),
    ))
    place(polyline(
      raw.map(point => (px(point.at(0), 0, 1, w), py(point.at(1), 0, 1, h))),
      stroke: 1.2pt + series-b,
    ))
    place(polyline(
      fixed.map(point => (px(point.at(0), 0, 1, w), py(point.at(1), 0, 1, h))),
      stroke: 1.3pt + series-a,
    ))
    for point in raw { marker(px(point.at(0), 0, 1, w), py(point.at(1), 0, 1, h), series-b, radius: 1.7pt) }
    for point in fixed { marker(px(point.at(0), 0, 1, w), py(point.at(1), 0, 1, h), series-a, radius: 1.7pt) }
    axes(w, h)
    for value in (0.0, 0.25, 0.5, 0.75, 1.0) {
      ytick(py(value, 0, 1, h), [#value])
      xtick(px(value, 0, 1, w), h, [#value])
    }
    xlabel(w, h, [Predicted probability])
    ylabel(h, [Observed frequency])
    place(dx: 0.3cm, dy: 0.2cm, box(width: 4.6cm, align(left, {
      swatch(series-b, [Raw ensemble])
      linebreak()
      swatch(series-a, [After isotonic fit])
      linebreak()
      swatch(luma(50%), [Perfect calibration])
    })))
  }),
  caption: [Reliability diagram on 40000 forward-holdout rows in eleven equal-mass
  bins. The raw ensemble is overconfident at both ends, predicting 0.03 where the
  outcome rate is 0.011 and 0.96 where it is 0.978. Isotonic regression removes
  the reliability term almost entirely.],
) <fig:calib>

Two recalibration methods cover nearly all cases. Platt scaling fits a
one-dimensional logistic regression to the model's scores
@platt1999probabilistic, which is a two-parameter correction and is therefore
stable on small calibration sets but cannot fix a non-sigmoidal distortion.
Isotonic regression fits the best non-decreasing step function
@zadrozny2002transforming, which can fix any monotone distortion at the cost of
needing considerably more data and of producing piecewise-constant output.
@tab:recalib gives the numbers for our ensemble.

#figure(
  book-table(
    columns: (1fr, auto, auto, auto, auto),
    align: (left, right, right, right, right),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Model*], [*AUC*], [*Brier*], [*Reliability*], [*ECE*],
    ),
    table.hline(stroke: 0.5pt),
    [Raw ensemble], [0.784], [0.1146], [0.0071], [0.041],
    [Platt scaled, $n_"cal" = 2000$], [0.784], [0.1092], [0.0019], [0.014],
    [Isotonic, $n_"cal" = 2000$], [0.783], [0.1101], [0.0026], [0.017],
    [Isotonic, $n_"cal" = 20000$], [0.784], [0.1081], [0.0008], [0.006],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Recalibration on the forward holdout. AUC is unchanged throughout,
  as it must be under a monotone map. Isotonic regression beats Platt scaling
  only once the calibration set is large; at 2000 rows it overfits the bins.],
) <tab:recalib>

#remark[
  Recalibrate on data the model has never seen, and never on the training set.
  A model fitted with early stopping has already used the validation fold, so a
  third split is required. We reserve ten percent of the forward window for
  calibration and report every metric on the remaining ninety.
]

== Intervals with a guarantee

Point predictions invite over-reading. The honest alternative is an interval, and
the difficulty is that intervals derived from a model's own error assumptions
inherit every one of those assumptions. Split conformal prediction avoids this
entirely @vovk2005algorithmic @lei2018distribution.

#theorem("Split conformal coverage")[
  Split the data into a proper training set and a calibration set of size $m$.
  Fit $hat(f)$ on the training set, compute residual scores
  $s_i = |y_i - hat(f)(x_i)|$ on the calibration set, and let $q_(1 - alpha)$ be
  the $ceil((m + 1)(1 - alpha)) slash m$ empirical quantile of ${s_i}$. Then for a
  new exchangeable pair $(x_(n+1), y_(n+1))$,
  $ Pr(y_(n+1) in [hat(f)(x_(n+1)) - q_(1-alpha), hat(f)(x_(n+1)) + q_(1-alpha)]) >= 1 - alpha. $ <eq:conformal>
  The guarantee is finite-sample, distribution-free, and holds for any
  $hat(f)$ whatsoever.
]

@eq:conformal asks for nothing except exchangeability between calibration and
test data. It does not require the model to be correct, the residuals to be
Gaussian, or the variance to be constant. What it gives up is conditional
coverage: the interval has the stated marginal coverage, but it can be too wide
in easy regions and too narrow in hard ones. Normalising the score by an
estimated difficulty, $s_i = |y_i - hat(f)(x_i)| slash hat(sigma)(x_i)$, recovers
much of the conditional behaviour and preserves the marginal guarantee exactly.

```python
import numpy as np


def split_conformal(model, x_cal, y_cal, alpha=0.1, difficulty=None):
    residuals = np.abs(y_cal - model.predict(x_cal))
    if difficulty is not None:
        residuals = residuals / np.maximum(difficulty(x_cal), 1e-9)

    m = residuals.size
    level = np.ceil((m + 1) * (1 - alpha)) / m
    if level > 1.0:
        raise ValueError(f"calibration set of {m} is too small for alpha={alpha}")
    width = float(np.quantile(residuals, level, method="higher"))

    def predict_interval(x):
        centre = model.predict(x)
        scale = difficulty(x) if difficulty is not None else 1.0
        return centre - width * scale, centre + width * scale

    return predict_interval, width
```

The guard on `level` is the part that gets removed. At $alpha = 0.05$ the
calibration set must hold at least 19 rows for the required quantile to exist,
and at $alpha = 0.01$ it needs 99. Below that threshold `np.quantile` returns the
maximum residual and the coverage guarantee silently becomes vacuous rather than
failing.

== What to monitor, and at what cadence

Monitoring is where the previous five chapters are cashed in. The sampling
design determines whether the monitored population still resembles the training
population, the descriptive summaries determine which statistics are worth
tracking, and the validation design determines what a degradation means.
@tab:monitor is the schedule we run.

#figure(
  book-table(
    columns: (1fr, auto, auto, auto),
    align: (left, center, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Signal*], [*Cadence*], [*Warn*], [*Page*],
    ),
    table.hline(stroke: 0.5pt),
    [Prediction volume vs 28 day median], [hourly], [$plus.minus 20$ percent], [$plus.minus 50$ percent],
    [Null rate per input feature], [hourly], [+2 pp], [+10 pp],
    [Score distribution, KS vs reference], [daily], [0.05], [0.12],
    [Feature PSI, top 10 by importance], [daily], [0.10], [0.25],
    [Holdout AUC on resolved labels], [weekly], [-0.010], [-0.025],
    [Reliability term of @eq:brier], [weekly], [+0.002], [+0.005],
    [Conformal interval empirical coverage], [weekly], [-2 pp], [-5 pp],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Monitoring schedule for the churn model. The first two rows are
  pipeline health and fire within the hour; everything below them requires
  either a distributional comparison or resolved labels and cannot.],
) <tab:monitor>

The cadence column is the important one and it is set by label latency, not by
preference. Rows one and two need no labels and can run continuously. Rows three
and four need only inputs and run daily because a single day of traffic is the
smallest window with a stable enough distribution to compare. The last three
require resolved outcomes, and with a sixty-day churn horizon the weekly cadence
is really a weekly recomputation over a window that ended two months ago.

#remark[
  A monitor that pages nobody is not a monitor. Every row of @tab:monitor names
  an owning team and a runbook entry, and any threshold that fires more than
  twice a quarter without an action being taken is either wrong or attached to a
  signal nobody uses. We audit thresholds against their firing history each
  quarter and delete the ones that survive only out of habit.
]

== Reporting

The report that accompanies a model release should let a reader reconstruct the
claim without rerunning anything. In our practice that means six items, and the
list is short enough that omitting one is a decision rather than an oversight.

First, the validation design, stated as a date range for training, a gap, and a
date range for evaluation. Second, the metric with an interval, computed on the
forward holdout and never on cross-validation. Third, the calibration evidence:
the reliability diagram and the Murphy decomposition of @eq:brier. Fourth, the
performance broken out by the segments the decision will treat differently,
because a pooled metric hides exactly the failure that a segment-specific
threshold will expose, as @tab:groups in Chapter 2 illustrated for latency.
Fifth, the monitoring plan with its thresholds and owners. Sixth, the conditions
under which the model should be withdrawn.

That last item is the one that is almost always missing, and it is the one that
makes the rest actionable. A release note that says the model will be retrained
when weekly AUC falls below 0.760 for three consecutive weeks has committed to
something checkable. A release note that says performance will be monitored has
not. The distinction costs one sentence to write and it determines whether
anything happens when the numbers move.
