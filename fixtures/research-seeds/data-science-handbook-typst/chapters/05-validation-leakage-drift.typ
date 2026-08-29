#import "../lib/style.typ": *

= Validation, Leakage, and Drift

A validation design is a claim about what the model will be asked to do. Random
$K$-fold cross-validation makes a specific and often false claim: that training
and deployment rows are exchangeable. When they are not, and in almost every
production system they are not, the estimate it produces is optimistic by an
amount that no confidence interval around it will reveal. This chapter is about
building validation designs that answer the question actually being asked.

== What cross-validation estimates

#definition("Prediction error")[
  For a learning algorithm $cal(A)$ and a training set $cal(D)_n$, the
  _conditional_ prediction error is
  $ "Err"_(cal(D)_n) = bb(E)_((x_0, y_0)) [L(y_0, hat(f)_(cal(D)_n) (x_0))] $
  and the _expected_ prediction error is $"Err" = bb(E)_(cal(D)_n) ["Err"_(cal(D)_n)]$.
  $K$-fold cross-validation is a nearly unbiased estimator of $"Err"$ at training
  size $n(1 - 1 slash K)$, and a poor estimator of $"Err"_(cal(D)_n)$.
]

The distinction is not pedantic. Practitioners use cross-validation to answer
"how well will this model do", which is a question about $"Err"_(cal(D)_n)$, the
error of the specific fitted model in hand. Cross-validation answers a different
question, about the average error of the procedure across training sets it did
not see @arlot2010survey. The two coincide when $n$ is large relative to model
complexity, and they diverge exactly when the model is complex and the data is
scarce, which is when someone is most likely to be relying on the number.

The variance of the estimate compounds the problem. Writing $"CV"_K$ for the
cross-validated risk, its variance decomposes as

$ op("Var")("CV"_K) = 1/K op("Var")(hat(R)_k) + (K - 1)/K op("Cov")(hat(R)_k, hat(R)_l), $ <eq:cvvar>

and the covariance term does not shrink with $K$. Leave-one-out
cross-validation, the $K = n$ limit, therefore has high variance rather than low:
the $n$ fitted models are nearly identical, the covariance term dominates, and
the estimate is stable in a way that reflects the folds rather than the data.
Five or ten folds remains the right default, and @tab:cv gives the tradeoff
concretely.

#figure(
  book-table(
    columns: (auto, auto, auto, auto, 1fr),
    align: (center, right, right, right, left),
    table.hline(stroke: 0.9pt),
    table.header(
      [*$K$*], [*Bias*], [*SD of estimate*], [*Fits*], [*Use when*],
    ),
    table.hline(stroke: 0.5pt),
    [2], [+0.041], [0.008], [2], [screening only, badly pessimistic],
    [5], [+0.011], [0.011], [5], [default for tuning],
    [10], [+0.005], [0.014], [10], [final reporting],
    [$n$], [+0.000], [0.026], [4128], [linear smoothers with a closed form],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Cross-validation designs for the churn model, $n = 4128$. Bias is
  measured against a 40000-row holdout and is reported in deviance units. Note
  that bias falls and the standard deviation rises as $K$ grows.],
) <tab:cv>

== Leakage

Leakage is the use, at training time, of information that will not exist at
prediction time @kaufman2012leakage. It is the single most common cause of a
model that validates well and fails on deployment, and it is almost never
introduced deliberately.

#theorem("The leakage signature")[
  Let $hat(R)_"cv"$ be the cross-validated risk and $hat(R)_"fwd"$ the risk on a
  strictly forward-in-time holdout. If the feature pipeline uses any statistic
  computed over the full data set, then $bb(E)[hat(R)_"cv"] <= bb(E)[hat(R)_"fwd"]$,
  with the gap increasing in the number of such statistics. A large positive gap
  is therefore evidence of leakage, though a small gap is not evidence of its
  absence.
]

Three forms account for most cases we find in review. _Preprocessing leakage_
occurs when a scaler, imputer, or target encoder is fitted on all rows before the
split, so every fold's training set has seen the held-out rows through the fitted
statistics. _Temporal leakage_ occurs when a feature is computed from a window
that extends past the prediction timestamp, which happens by default in any
aggregation that is not explicitly bounded. _Target leakage_ occurs when a
feature is a consequence of the outcome rather than a cause: a `cancellation_reason`
column is a perfect predictor of cancellation and is populated only afterwards.

#remark[
  The diagnostic that catches all three is a comparison of cross-validated
  against forward-holdout performance. On the churn model, a version with a
  full-data target encoder scored 0.842 AUC under five-fold cross-validation and
  0.771 on the forward holdout. The correctly-fitted version scored 0.788 and
  0.784. The second model is worse by cross-validation and better in every way
  that matters.
]

The pipeline below is the shape we require. Every fitted transformation lives
inside the estimator so that the splitter cannot leak across it, and the temporal
features are computed with an explicit closed right boundary.

```python
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.impute import SimpleImputer
from sklearn.model_selection import TimeSeriesSplit, cross_val_score


def build_pipeline(numeric, categorical, estimator):
    numeric_branch = Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("scale", StandardScaler()),
    ])
    categorical_branch = Pipeline([
        ("impute", SimpleImputer(strategy="constant", fill_value="__missing__")),
        ("encode", OneHotEncoder(handle_unknown="ignore", min_frequency=25)),
    ])
    return Pipeline([
        ("features", ColumnTransformer([
            ("num", numeric_branch, numeric),
            ("cat", categorical_branch, categorical),
        ])),
        ("model", estimator),
    ])


def purged_scores(pipeline, frame, features, label, embargo_days=7, n_splits=5):
    ordered = frame.sort_values("as_of_date")
    splitter = TimeSeriesSplit(n_splits=n_splits, gap=embargo_days)
    return cross_val_score(
        pipeline, ordered[features], ordered[label],
        cv=splitter, scoring="neg_log_loss",
    )
```

== Selection bias in the reported metric

There is a second leak that survives a correct pipeline, and it is one that
careful teams still fall into. If the same cross-validation folds are used to
choose hyperparameters and to report the chosen model's performance, the reported
number is the maximum over a search rather than an estimate of any single model's
error, and the maximum of a set of noisy estimates is biased upward.

#theorem("Optimism of the selected fold estimate")[
  Let $hat(R)_1, dots, hat(R)_T$ be cross-validated risks for $T$ candidate
  configurations, each unbiased for its own true risk $R_t$ with error variance
  $tau^2$. Then the risk estimate of the selected configuration satisfies
  $ bb(E)[min_t hat(R)_t] <= min_t R_t, $
  with a gap that grows in $tau$ and in $T$. For independent Gaussian errors the
  gap is approximately $tau sqrt(2 log T)$.
]

The approximation is worth putting numbers to. On the churn model the
five-fold estimate has $tau approx 0.011$ deviance units from @tab:cv, and a
modest random search evaluates $T = 200$ configurations. The expected optimism is
then about $0.011 sqrt(2 log 200) = 0.026$ deviance units, which is larger than
the entire improvement the search was trying to find. A team that reports the
best cross-validated score as the model's performance has reported a number that
is wrong by more than the effect it is claiming.

Nested cross-validation removes the bias. The inner loop selects, the outer loop
estimates, and no fold of the outer loop ever participates in the selection that
produced the model it scores. The cost is multiplicative: $K_"outer" times K_"inner"$
fits for one honest number. In practice we use nested cross-validation when the
absolute level of the metric matters, for instance in a regulatory filing or a
go-or-no-go decision, and a single forward holdout otherwise.

#figure(
  book-table(
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, right),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Protocol*], [*Reported deviance*], [*True deviance*], [*Optimism*],
    ),
    table.hline(stroke: 0.5pt),
    [Best of 200, five-fold], [0.336], [0.361], [0.025],
    [Best of 20, five-fold], [0.347], [0.360], [0.013],
    [Nested, 5 outer by 5 inner], [0.359], [0.361], [0.002],
    [Single forward holdout], [0.364], [0.361], [-0.003],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Reported against true deviance for four evaluation protocols on the
  churn model. True deviance is measured on a 40000-row holdout that no protocol
  touched. The optimism of the unnested search matches the
  $tau sqrt(2 log T)$ approximation closely.],
) <tab:nested>

@tab:nested also shows why the forward holdout carries a small negative
optimism. It is a single estimate on a smaller sample, so it is noisier in both
directions, and here it happened to land pessimistic. Unbiased is not the same as
accurate, and a protocol that removes the bias still owes the reader an interval.

== Temporal validation and the embargo

When observations carry timestamps and the outcome is observed after a delay, a
random split is indefensible. The correct design trains on a past window and
evaluates on a future one, and it leaves an embargo gap between them equal to the
outcome horizon. Without the gap, a training row whose outcome was resolved after
the split boundary carries information from the evaluation period.

@fig:splits draws the two designs against the same eighteen-month record. The
random design uses every row for training and evaluates on rows interleaved
throughout the period. The forward design gives up the last window entirely and
embargoes the boundary.

#figure(
  box(width: 11.4cm, height: 5.7cm, {
    let w = 10.2cm
    let x0 = 1.1cm
    place(dx: x0, dy: 0.0cm, box(width: w, align(left, text(size: 7.5pt, fill: luma(35%))[
      Random $K$-fold, five folds
    ])))
    for i in range(5) {
      place(dx: 0cm, dy: 0.42cm + 0.33cm * i, box(width: 0.95cm, align(right, text(size: 6.5pt, fill: luma(45%))[fold #(i + 1)])))
      for j in range(5) {
        place(
          dx: x0 + w * j / 5,
          dy: 0.4cm + 0.33cm * i,
          rect(
            width: w / 5 - 0.04cm,
            height: 0.26cm,
            fill: if i == j { series-b.lighten(35%) } else { series-a.lighten(70%) },
            stroke: none,
          ),
        )
      }
    }

    place(dx: x0, dy: 2.22cm, box(width: w, align(left, text(size: 7.5pt, fill: luma(35%))[
      Forward chaining with a seven day embargo
    ])))
    for i in range(4) {
      let train-end = 0.30 + 0.15 * i
      let gap = 0.045
      let y = 2.62cm + 0.42cm * i
      place(dx: 0cm, dy: y + 0.02cm, box(width: 0.95cm, align(right, text(size: 6.5pt, fill: luma(45%))[round #(i + 1)])))
      place(dx: x0, dy: y, rect(width: w * train-end, height: 0.3cm, fill: series-a.lighten(60%), stroke: none))
      place(dx: x0 + w * train-end, dy: y, rect(width: w * gap, height: 0.3cm, fill: luma(58%), stroke: none))
      place(dx: x0 + w * (train-end + gap), dy: y, rect(width: w * 0.15, height: 0.3cm, fill: series-b.lighten(35%), stroke: none))
    }

    place(dx: x0, dy: 4.5cm, line(length: w, stroke: 0.6pt + luma(35%)))
    for (i, month) in ("Jan", "Apr", "Jul", "Oct", "Jan", "Apr", "Jul").enumerate() {
      place(dx: x0 + w * i / 6, dy: 4.5cm, line(angle: 90deg, length: 3pt, stroke: 0.6pt + luma(35%)))
      place(dx: x0 + w * i / 6 - 0.45cm, dy: 4.64cm, box(width: 0.9cm, align(center, text(size: 6.5pt, month))))
    }
    place(dx: x0, dy: 5.1cm, align(left, {
      box(width: 0.35cm, height: 0.2cm, fill: series-a.lighten(60%))
      text(size: 7pt)[ train #h(9pt)]
      box(width: 0.35cm, height: 0.2cm, fill: luma(58%))
      text(size: 7pt)[ embargo #h(9pt)]
      box(width: 0.35cm, height: 0.2cm, fill: series-b.lighten(35%))
      text(size: 7pt)[ evaluate]
    }))
  }),
  caption: [Two validation designs over the same eighteen months. The random
  design evaluates on rows drawn from the whole period and reports 0.842 AUC. The
  forward design evaluates only on unseen future windows and reports 0.784.],
) <fig:splits>

The difference between 0.842 and 0.784 in @fig:splits is not noise and it is not
a defect of the forward design. It is the amount by which the random design was
answering an easier question.

== Drift

A model in production faces a distribution that moves. It is worth separating
the two ways it moves, because they call for different responses.

#definition("Covariate shift and concept drift")[
  Write the joint law of the deployment data at time $t$ as $P_t (x, y) = P_t (x) P_t (y | x)$.
  _Covariate shift_ is a change in $P_t (x)$ with $P_t (y | x)$ fixed. _Concept
  drift_ is a change in $P_t (y | x)$ @gama2014drift. Covariate shift degrades a
  model only where it was already weak; concept drift invalidates what it learned.
]

Covariate shift is detectable from inputs alone, which makes it cheap to monitor.
The population stability index compares a deployment window against the training
reference over a fixed binning:

$ "PSI" = sum_(b=1)^B (p_b - q_b) log(p_b / q_b), $ <eq:psi>

where $p_b$ and $q_b$ are the deployment and reference proportions in bin $b$.
@eq:psi is a symmetrised Kullback-Leibler divergence, and the conventional
thresholds of 0.1 and 0.25 are rules of thumb rather than tests. We use them as
triggers for investigation, never as automatic retraining conditions.

Concept drift cannot be detected from inputs. It requires labels, and labels
arrive after the outcome horizon, so concept drift is always discovered late.
@fig:drift shows the consequence for the churn model over eleven months of
operation.

#figure(
  chart(9.6cm, 4.4cm, {
    let w = 9.6cm
    let h = 4.4cm
    let months = (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    let auc = (0.784, 0.781, 0.779, 0.776, 0.772, 0.771, 0.758, 0.741, 0.729, 0.726, 0.724)
    let psi = (0.02, 0.03, 0.05, 0.04, 0.07, 0.09, 0.18, 0.27, 0.31, 0.29, 0.30)
    gridlines-y(w, h, 4)
    place(polyline(
      months.map(m => (px(m, 0, 10, w), py(auc.at(m), 0.70, 0.80, h))),
      stroke: 1.4pt + series-a,
    ))
    place(polyline(
      months.map(m => (px(m, 0, 10, w), py(psi.at(m), 0.0, 0.40, h))),
      stroke: (paint: series-b, thickness: 1.2pt, dash: "dashed"),
    ))
    place(dx: 0pt, dy: py(0.25, 0.0, 0.40, h), line(length: w, stroke: (paint: series-b.lighten(40%), thickness: 0.6pt, dash: "dotted")))
    place(dx: px(6, 0, 10, w), dy: 0pt, line(angle: 90deg, length: h, stroke: (paint: luma(45%), thickness: 0.6pt, dash: "dashed")))
    place(dx: px(6, 0, 10, w) + 0.12cm, dy: 0.15cm, box(width: 3.0cm, text(size: 7pt, fill: luma(30%))[pricing change ships]))
    axes(w, h)
    for value in (0.70, 0.725, 0.75, 0.775, 0.80) { ytick(py(value, 0.70, 0.80, h), [#value]) }
    for value in (0, 2, 4, 6, 8, 10) { xtick(px(value, 0, 10, w), h, [#value]) }
    xlabel(w, h, [Months since deployment])
    ylabel(h, [Holdout AUC])
    place(dx: 0.35cm, dy: 1.55cm, box(width: 4.6cm, align(left, {
      swatch(series-a, [Holdout AUC, left axis])
      linebreak()
      swatch(series-b, [Feature PSI, right axis])
    })))
    for value in (0.0, 0.1, 0.2, 0.3, 0.4) {
      place(dx: w + 4pt, dy: py(value, 0.0, 0.40, h) - 4.5pt, text(size: 7pt, fill: series-b)[#value])
    }
  }),
  caption: [Eleven months of churn-model operation. PSI crosses the 0.25
  threshold in month seven, one month after a pricing change and two months after
  AUC began to fall. The input monitor was late because the change altered the
  outcome relationship before it altered the input distribution.],
) <fig:drift>

The sequence in @fig:drift is the one worth internalising. AUC turned at month
six, PSI crossed its threshold at month seven, and the model was retrained in
month nine after a quarterly review. An input-only monitor would have raised the
alarm one month late; an outcome monitor with a sixty-day label delay would have
raised it two months late. Neither is fast, which is why the pricing change
itself, a known upstream event, is the signal that should have triggered
revalidation. The most reliable drift detector in most organisations is a
calendar of planned changes to the systems that generate the features, and
maintaining that calendar is a coordination problem rather than a statistical
one @sculley2015debt.
