#import "../lib/style.typ": *

= Tree Ensembles and Gradient Boosting

A single regression tree is a poor estimator. It is high variance, discontinuous
at every split, and unstable to the point that two trees grown on bootstrap
replicates of the same data frequently share no split above depth two. Every
useful property of tree methods comes from combining many such estimators, and
the two dominant ways of combining them, averaging and stagewise addition, sit
at opposite ends of the bias-variance trade we developed in Chapter 3.

== A tree is a partition, not a rule list

#definition("Regression tree")[
  A regression tree of size $M$ is a piecewise-constant function
  $ f(x) = sum_(m=1)^M c_m bb(1){x in R_m}, $
  where ${R_1, dots, R_M}$ is a partition of the predictor space into axis-aligned
  rectangles and $c_m$ is the constant fitted in region $R_m$. Under squared
  error, $hat(c)_m$ is the mean of the training responses falling in $R_m$.
]

The partition is grown greedily. At each node the algorithm searches over
predictors $j$ and thresholds $t$ for the split that most reduces an impurity
criterion, and the reduction from splitting node $R$ into $R_L$ and $R_R$ is

$ Delta(j, t) = H(R) - (|R_L|/|R|) H(R_L) - (|R_R|/|R|) H(R_R), $ <eq:gain>

with $H$ the node impurity. For regression $H$ is the within-node variance; for
classification the usual choices are the Gini index
$H = sum_k p_k (1 - p_k)$ and the entropy $H = -sum_k p_k log p_k$. The choice
between them changes very little, and arguments about it consume more time than
they deserve.

What matters much more is that @eq:gain is greedy and axis-aligned. Greedy means
a split that is worthless on its own but valuable in combination will never be
found, which is why trees handle interactions well but pure additive rotations
badly. Axis-aligned means a linear boundary at forty-five degrees is approximated
by a staircase, and the number of splits needed to reach a fixed accuracy grows
with the dimension.

@fig:tree shows a fitted tree for the churn model we use throughout this
chapter, pruned to depth three so that the structure is legible.

#figure(
  box(width: 11.6cm, height: 5.5cm, {
    let split(x, y, body) = node(x, y, 2.9cm, 0.78cm, body, fill: series-a.lighten(90%))
    let leaf(x, y, body, tone) = node(x, y, 1.8cm, 0.72cm, body, fill: tone)

    split(4.35cm, 0.0cm, [tenure_months $< 14$])
    split(1.45cm, 1.55cm, [support_calls $>= 3$])
    split(7.25cm, 1.55cm, [discount_pct $< 5$])

    leaf(0.0cm, 3.25cm, [0.71 \ $n = 812$], series-b.lighten(58%))
    leaf(2.3cm, 3.25cm, [0.38 \ $n = 1104$], series-b.lighten(84%))
    leaf(6.5cm, 3.25cm, [0.19 \ $n = 2431$], series-c.lighten(78%))
    leaf(8.8cm, 3.25cm, [0.07 \ $n = 3907$], series-c.lighten(58%))

    connect(5.8cm, 0.78cm, 2.9cm, 1.5cm)
    arrow-head(2.9cm, 1.55cm, "down", size: 3.2pt)
    connect(5.8cm, 0.78cm, 8.7cm, 1.5cm)
    arrow-head(8.7cm, 1.55cm, "down", size: 3.2pt)
    connect(2.9cm, 2.33cm, 0.9cm, 3.2cm)
    arrow-head(0.9cm, 3.25cm, "down", size: 3.2pt)
    connect(2.9cm, 2.33cm, 3.2cm, 3.2cm)
    arrow-head(3.2cm, 3.25cm, "down", size: 3.2pt)
    connect(8.7cm, 2.33cm, 7.4cm, 3.2cm)
    arrow-head(7.4cm, 3.25cm, "down", size: 3.2pt)
    connect(8.7cm, 2.33cm, 9.7cm, 3.2cm)
    arrow-head(9.7cm, 3.25cm, "down", size: 3.2pt)

    place(dx: 3.6cm, dy: 0.95cm, text(size: 7pt, fill: luma(40%))[yes])
    place(dx: 7.5cm, dy: 0.95cm, text(size: 7pt, fill: luma(40%))[no])
    place(dx: 1.2cm, dy: 2.62cm, text(size: 7pt, fill: luma(40%))[yes])
    place(dx: 3.1cm, dy: 2.62cm, text(size: 7pt, fill: luma(40%))[no])
    place(dx: 7.5cm, dy: 2.62cm, text(size: 7pt, fill: luma(40%))[yes])
    place(dx: 9.4cm, dy: 2.62cm, text(size: 7pt, fill: luma(40%))[no])
    place(dx: 0.0cm, dy: 4.35cm, text(size: 7.5pt, fill: luma(35%))[
      Leaf values are predicted churn probabilities; $n$ is the training count in the leaf.
    ])
  }),
  caption: [A depth-three regression tree for the churn model. Tenure splits
  first because it separates the population most cleanly, and the support-call
  split appears only on the short-tenure branch, which is an interaction the
  greedy search found without being told to look for one.],
) <fig:tree>

== Bagging and random forests

Averaging $B$ trees grown on bootstrap replicates reduces variance without
touching bias. If the individual trees have variance $sigma^2$ and pairwise
correlation $rho$, the variance of their average is

$ op("Var")(1/B sum_(b=1)^B hat(f)_b (x)) = rho sigma^2 + (1 - rho)/B sigma^2. $ <eq:bagvar>

@eq:bagvar is the entire argument for random forests @breiman2001randomforest.
The second term vanishes as $B$ grows, so adding trees is free improvement up to
the point where it stops mattering. The first term does not vanish, and it is
the binding constraint. Reducing $rho$ therefore matters more than growing $B$,
and the forest achieves that by restricting each split to a random subset of
$m_"try"$ predictors, which forces different trees to use different variables.

#remark[
  Because the first term of @eq:bagvar dominates beyond a few hundred trees, the
  number of trees in a forest is not a hyperparameter to be tuned. Set it as
  large as the latency budget allows and tune $m_"try"$ and the leaf size, which
  are the parameters that actually move $rho$ and $sigma^2$.
]

Out-of-bag error is the forest's other convenience. Each bootstrap replicate
omits about $e^(-1) approx 36.8$ percent of the rows, so every observation has
roughly $0.368 B$ trees that never saw it, and averaging those gives a
cross-validated error estimate for the cost of the fit already performed.

== Gradient boosting

Boosting builds the ensemble additively rather than in parallel. At stage $m$ the
model is $F_m = F_(m-1) + nu h_m$, and $h_m$ is a shallow tree fitted to the
negative gradient of the loss at the current fit @friedman2001greedy:

$ g_(i m) = - [(partial L(y_i, F(x_i)))/(partial F(x_i))]_(F = F_(m-1)), quad
  h_m = op("arg min", limits: #true)_(h in cal(H)) sum_(i=1)^n (g_(i m) - h(x_i))^2. $ <eq:boost>

The learning rate $nu$ scales each contribution. Modern implementations fit a
second-order approximation instead, expanding the loss to two terms and solving
for the leaf weights in closed form @chen2016xgboost. With gradient $g_i$,
Hessian $h_i$, and regularisation $lambda$, the optimal weight in leaf $j$ and
the resulting objective reduction are

$ w_j^* = - (sum_(i in I_j) g_i) / (sum_(i in I_j) h_i + lambda), quad
  cal(L)^* = -1/2 sum_(j=1)^T ((sum_(i in I_j) g_i)^2) / (sum_(i in I_j) h_i + lambda) + gamma T. $ <eq:xgb>

@eq:xgb is what makes second-order boosting fast to tune. The split gain is
computed from the same quantities, so the search criterion and the leaf fit come
from one pass over the gradients rather than from a separate line search.

@fig:boost shows train and validation deviance against the number of boosting
rounds at three learning rates. The picture contains the entire practical lesson:
a smaller learning rate reaches a lower validation minimum and takes proportionally
more rounds to get there, and the product $nu times M$ is roughly conserved.

#figure(
  chart(9.6cm, 4.6cm, {
    let w = 9.6cm
    let h = 4.6cm
    let xs = (0, 100, 200, 300, 400, 500, 600, 700, 800)
    let val-fast = (0.693, 0.412, 0.381, 0.377, 0.383, 0.394, 0.408, 0.424, 0.441)
    let val-mid = (0.693, 0.446, 0.389, 0.368, 0.361, 0.360, 0.364, 0.371, 0.380)
    let val-slow = (0.693, 0.521, 0.437, 0.399, 0.379, 0.368, 0.362, 0.359, 0.358)
    let train-mid = (0.693, 0.421, 0.352, 0.311, 0.281, 0.257, 0.237, 0.220, 0.205)
    gridlines-y(w, h, 4)
    let draw(values, colour, thickness, dash) = place(polyline(
      xs.enumerate().map(pair => (px(pair.at(1), 0, 800, w), py(values.at(pair.at(0)), 0.18, 0.72, h))),
      stroke: (paint: colour, thickness: thickness, dash: dash),
    ))
    draw(train-mid, series-d, 1.0pt, "dashed")
    draw(val-fast, series-b, 1.2pt, none)
    draw(val-mid, series-a, 1.4pt, none)
    draw(val-slow, series-c, 1.2pt, none)
    marker(px(300, 0, 800, w), py(0.377, 0.18, 0.72, h), series-b, radius: 2.1pt)
    marker(px(500, 0, 800, w), py(0.360, 0.18, 0.72, h), series-a, radius: 2.1pt)
    marker(px(800, 0, 800, w), py(0.358, 0.18, 0.72, h), series-c, radius: 2.1pt)
    axes(w, h)
    for value in (0.18, 0.315, 0.45, 0.585, 0.72) { ytick(py(value, 0.18, 0.72, h), [#value]) }
    for value in (0, 200, 400, 600, 800) { xtick(px(value, 0, 800, w), h, [#value]) }
    xlabel(w, h, [Boosting rounds $M$])
    ylabel(h, [Binomial deviance])
    place(dx: 4.3cm, dy: 0.2cm, box(width: 5.0cm, align(left, {
      swatch(series-b, [Validation, $nu = 0.10$])
      linebreak()
      swatch(series-a, [Validation, $nu = 0.05$])
      linebreak()
      swatch(series-c, [Validation, $nu = 0.02$])
      linebreak()
      swatch(series-d, [Training, $nu = 0.05$, dashed])
    })))
  }),
  caption: [Boosting curves for the churn model at three learning rates, depth 4,
  with 20 percent column subsampling. Marked points are the validation minima at
  300, 500, and 800 rounds. Training deviance falls monotonically at every rate,
  which is why it can never be used as a stopping signal.],
) <fig:boost>

The dashed training curve in @fig:boost is included as a warning. It declines
without limit and gives no indication that the validation curve turned upward two
hundred rounds earlier. Early stopping must therefore be driven by a held-out
fold, and the number of rounds selected on that fold is itself a fitted
parameter that has to be re-selected whenever anything upstream changes.

== Hyperparameters that matter, in order

@tab:hyper lists the parameters in the order we tune them. The ordering is not
arbitrary: each row is roughly conditionally independent of the rows below it,
so a coarse search over the top three followed by a refinement of the rest costs
far less than a joint search and loses very little.

#figure(
  book-table(
    columns: (auto, auto, 1fr, auto),
    align: (left, center, left, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Parameter*], [*Range*], [*What it controls*], [*Sensitivity*],
    ),
    table.hline(stroke: 0.5pt),
    [Learning rate $nu$], [0.01 to 0.3], [step size per tree, trades rounds for accuracy], [High],
    [Max depth], [3 to 8], [highest-order interaction the ensemble can express], [High],
    [Min child weight], [1 to 100], [minimum Hessian mass per leaf, the real leaf-size control], [Medium],
    [Column subsample], [0.5 to 1.0], [decorrelation across rounds], [Medium],
    [Row subsample], [0.5 to 1.0], [stochastic gradient noise], [Low],
    [$L_2$ penalty $lambda$], [0 to 10], [leaf-weight shrinkage in @eq:xgb], [Low],
    [$gamma$ split penalty], [0 to 5], [minimum gain required to keep a split], [Low],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Boosting hyperparameters in tuning order. Sensitivity is the
  validation deviance range observed across the stated interval on our churn
  model with all other parameters held at their defaults.],
) <tab:hyper>

The training routine below encodes that ordering, together with the two
constraints we impose on every production ensemble: early stopping against a
held-out fold, and monotone constraints on the features where a non-monotone
response would be indefensible to a reviewer.

```python
import lightgbm as lgb


MONOTONE = {"tenure_months": -1, "support_calls": 1, "discount_pct": -1}


def fit_churn_model(train, valid, features, label="churned", learning_rate=0.05):
    constraints = [MONOTONE.get(name, 0) for name in features]
    params = {
        "objective": "binary",
        "metric": "binary_logloss",
        "learning_rate": learning_rate,
        "max_depth": 4,
        "min_child_weight": 20,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "lambda_l2": 1.0,
        "monotone_constraints": constraints,
        "verbosity": -1,
    }
    booster = lgb.train(
        params,
        lgb.Dataset(train[features], label=train[label]),
        num_boost_round=2000,
        valid_sets=[lgb.Dataset(valid[features], label=valid[label])],
        callbacks=[lgb.early_stopping(stopping_rounds=50, verbose=False)],
    )
    return booster, booster.best_iteration
```

Monotone constraints deserve a defence, because they cost accuracy. On the churn
model they raise validation deviance from 0.360 to 0.364, a loss of roughly one
percent. We accept it because the unconstrained model learned that churn
probability _falls_ between four and six support calls, an artefact of a thin
region of the training data that no reviewer would accept and that would have
been discovered in production rather than in review. Constraining a feature is
how a modelling team encodes a fact it already knows, and a fact that is already
known should not have to be relearned from a thin slice of data
@ke2017lightgbm.

== Reading a fitted ensemble

An ensemble cannot be written down, but it can be interrogated, and the
interrogation tools differ enough in what they measure that reporting the wrong
one is a common source of confusion in review.

Gain importance sums the impurity reduction of @eq:gain over every split on a
feature. It is free, it is computed during training, and it is biased toward
high-cardinality features, because a variable with many distinct values offers
the greedy search more thresholds and therefore more chances to reduce impurity
by luck. Split-count importance is worse on the same axis. Permutation
importance measures the degradation in a held-out metric when a feature's values
are shuffled, which removes the cardinality bias at the cost of a full
re-scoring pass per feature and of an inflated estimate whenever two features
are correlated, since shuffling one leaves the model able to recover the signal
from the other.

#definition("Partial dependence")[
  For a fitted $hat(f)$ and a feature subset $S$ with complement $C$, the
  partial dependence of $hat(f)$ on $x_S$ is
  $ hat("PD")_S (x_S) = 1/n sum_(i=1)^n hat(f)(x_S, x_(C, i)), $ <eq:pd>
  the average prediction obtained by fixing $x_S$ and marginalising the observed
  distribution of the remaining features.
]

@eq:pd is an average over the _marginal_ distribution of $x_C$, not the
conditional one, so it evaluates the model at feature combinations that may
never occur. On the churn model, tenure and support calls are strongly
negatively correlated, and the partial dependence curve for support calls
therefore averages predictions at long tenure with ten support calls, a
combination that appears four times in 4128 rows. The curve is a statement about
the fitted function in a region where the function was never constrained.

#figure(
  book-table(
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, right),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Feature*], [*Gain*], [*Permutation*], [*Rank shift*],
    ),
    table.hline(stroke: 0.5pt),
    [tenure_months], [0.284], [0.061], [0],
    [support_calls], [0.191], [0.048], [0],
    [discount_pct], [0.147], [0.019], [-1],
    [plan_tier], [0.063], [0.024], [+1],
    [monthly_spend], [0.118], [0.011], [-2],
    [signup_channel], [0.041], [0.014], [+1],
    [account_id_hash], [0.096], [0.002], [-4],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Gain against permutation importance on the churn ensemble.
  Permutation values are the mean deviance increase over 20 shuffles on the
  forward holdout. Rank shift is the change in ordering between the two columns.],
) <tab:importance>

@tab:importance shows why the distinction is not academic. The hashed account
identifier ranks fourth by gain and last by permutation. It has 4128 distinct
values, so it offers the greedy search a threshold between almost every pair of
adjacent rows, and it reduces training impurity substantially while carrying no
information that transfers to the holdout. A feature-selection process driven by
gain would have retained it. One driven by permutation importance removes it,
which is the correct outcome and also, in this case, the removal of a leakage
vector.

We therefore report permutation importance on a held-out fold as the default,
gain only as a training diagnostic, and partial dependence only with the joint
support of the plotted features shown alongside it.

== When not to use an ensemble

Two situations still favour the penalised linear model of Chapter 3. The first is
extrapolation. A tree ensemble predicts a constant outside the convex hull of its
training data, because every leaf is bounded, so a model asked about a customer
with twice the largest observed tenure returns the value for the largest observed
tenure. When the operating range is expected to drift beyond the training range,
that behaviour is a silent failure rather than an error.

The second is the case where the fitted function itself is the deliverable. An
ensemble of eight hundred trees can be interrogated with importance measures and
partial dependence, but it cannot be written down, and a coefficient table that a
domain expert can argue with is often worth more than the two points of AUC that
separate it from the boosted alternative. We keep a linear model alongside every
ensemble for this reason, and we report both.
