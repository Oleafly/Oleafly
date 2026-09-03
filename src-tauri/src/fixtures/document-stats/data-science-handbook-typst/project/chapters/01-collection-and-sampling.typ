#import "../lib/style.typ": *

= Data Collection and Sampling

A supervised model is a claim about a population, but it is fitted on a sample.
Everything the sample fails to represent becomes a term in the model's error
that no amount of tuning will reach. This chapter develops the vocabulary for
that gap and the arithmetic for correcting the part of it that is correctable.
The argument we want to establish is narrow and practical: the inclusion
mechanism is part of the model, and a pipeline that discards it has thrown away
information it cannot recover later.

== The frame is the real population

Analysts speak loosely about "the data" as though it were the population of
interest. It is not. Between the population a decision concerns and the rows in
a table sit two distinct reductions, and each one introduces a bias with its own
sign and magnitude.

#definition("Sampling frame")[
  Let $U = {1, dots, N}$ be the target population, the finite set of units about
  which a decision will be made. The _sampling frame_ $F$ is the set of units
  that the collection instrument is capable of observing. Units in $U without F$
  are _undercovered_, and units in $F without U$ are _overcovered_.
]

@fig:coverage shows the arrangement. The two failure modes are not symmetric.
Overcoverage is usually detectable, because the offending units can be
identified and removed once they are in hand. Undercoverage is invisible from
inside the sample: no statistic computed on $F$ reveals how many units of $U$
the instrument never had a chance to see.

#figure(
  box(width: 11.6cm, height: 5.5cm, {
    place(dx: 3.5cm, dy: 0.75cm, rect(width: 2.5cm, height: 3.3cm, fill: series-a.lighten(84%), stroke: none))
    place(dx: 0.5cm, dy: 0.75cm, rect(width: 5.5cm, height: 3.3cm, stroke: 0.9pt + series-a))
    place(dx: 3.5cm, dy: 0.75cm, rect(width: 5.5cm, height: 3.3cm, stroke: 0.9pt + series-b))
    place(dx: 4.05cm, dy: 2.05cm, circle(radius: 0.62cm, fill: white, stroke: (paint: luma(25%), thickness: 0.8pt, dash: "dashed")))
    place(dx: 4.05cm, dy: 2.42cm, box(width: 1.24cm, align(center, text(size: 9pt)[$s$])))
    place(dx: 0.7cm, dy: 1.5cm, box(width: 2.6cm, align(center, text(size: 8pt)[
      Undercoverage \ #v(2pt) $U without F$
    ])))
    place(dx: 3.5cm, dy: 0.95cm, box(width: 2.5cm, align(center, text(size: 8pt)[Covered])))
    place(dx: 6.3cm, dy: 1.5cm, box(width: 2.4cm, align(center, text(size: 8pt)[
      Overcoverage \ #v(2pt) $F without U$
    ])))
    place(dx: 0.5cm, dy: 4.2cm, box(width: 3.0cm, align(center, text(size: 8.5pt, fill: series-a)[
      Target population $U$
    ])))
    place(dx: 6.0cm, dy: 4.2cm, box(width: 3.0cm, align(center, text(size: 8.5pt, fill: series-b)[
      Sampling frame $F$
    ])))
    place(dx: 9.3cm, dy: 2.35cm, box(width: 2.2cm, text(size: 7.5pt, fill: luma(35%))[
      Selected sample $s subset.eq F$, of size $n$
    ]))
    connect(9.1cm, 2.6cm, 8.05cm, 2.67cm, stroke: 0.6pt + luma(45%))
  }),
  caption: [Coverage geometry. The estimator is computed on $s$, the decision
  concerns $U$, and the two sets meet only through the shaded region. Nothing
  measured inside $s$ identifies the size of $U without F$.],
) <fig:coverage>

The consequence is an identity worth memorising. Write $N_u = |U without F|$ for
the undercovered count, $mu_U$ for the population mean of $y$, $mu_F$ for its
mean over the covered units, and $mu_u$ for its mean over the undercovered ones.
Then

$ mu_F - mu_U = (N_u / N) (mu_F - mu_u). $ <eq:coverage>

@eq:coverage says that coverage bias is a product of a rate and a contrast. A
frame that misses one percent of the population is harmless when the missing
units resemble the rest, and it is catastrophic when they do not. Neither factor
is estimable from the sample alone, which is why frame documentation is a
methodological artefact rather than an administrative one @kish1965survey.

#remark[
  In observational settings the frame is often implicit. A model trained on
  support tickets has a frame consisting of customers who both experienced a
  problem and chose to report it. The second condition is a behavioural filter,
  and it correlates with almost every outcome such a model is likely to predict.
]

== Design-based estimation

Once the frame is fixed, the remaining randomness comes from the design: the
probability distribution over subsets of $F$ that the collection procedure
implements. The design is knowledge, not noise, and design-based estimation is
the machinery for spending it.

#definition("Inclusion probability")[
  For a design $p(dot)$ over subsets of $F$, the first-order inclusion
  probability of unit $i$ is $pi_i = Pr(i in s)$ and the second-order inclusion
  probability of units $i$ and $j$ is $pi_(i j) = Pr(i in s and j in s)$. A
  design is _measurable_ when $pi_i > 0$ for every $i in F$.
]

The estimator that exploits these quantities is the Horvitz-Thompson estimator
@horvitz1952generalization, which reweights each observed value by the
reciprocal of its inclusion probability:

$ hat(T)_"HT" = sum_(i in s) y_i / pi_i, quad hat(mu)_"HT" = 1/N sum_(i in s) y_i / pi_i. $ <eq:ht>

#theorem("Design unbiasedness")[
  If $pi_i > 0$ for all $i in F$, then $bb(E)_p [hat(T)_"HT"] = sum_(i in F) y_i$
  for every fixed vector $y$, with variance
  $ op("Var")_p (hat(T)_"HT") = sum_(i in F) sum_(j in F) (pi_(i j) - pi_i pi_j) y_i / pi_i dot y_j / pi_j. $ <eq:ht-var>
  The expectation is over the design only. No distributional assumption about
  $y$ is required.
]

The proof is two lines with an indicator variable, and the result is stronger
than it looks: unbiasedness holds whatever the shape of $y$, which is precisely
the guarantee that model-based estimation cannot offer. What @eq:ht-var also
shows is where design-based estimation becomes expensive. Units with small
$pi_i$ carry large weights, and a single such unit can dominate the variance.

@fig:chain traces the full path from population to estimate and marks where each
error term enters. We return to the calibration step in the next section.

#figure(
  box(width: 11.0cm, height: 4.3cm, {
    let top = 0.55cm
    let xs = (0cm, 2.9cm, 5.8cm, 8.7cm)
    let labels = ([Population \ $U$], [Frame \ $F$], [Sample \ $s$], [Estimate \ $hat(theta)$])
    let fills = (luma(97%), luma(97%), luma(97%), series-c.lighten(88%))
    for (i, x) in xs.enumerate() {
      node(x, top, 2.3cm, 1.0cm, labels.at(i), fill: fills.at(i))
    }
    let arrow-labels = ([coverage], [design $p(s)$], [$1 slash pi_i$])
    for i in range(3) {
      let x1 = xs.at(i) + 2.3cm
      let x2 = xs.at(i + 1)
      let mid = (x1 + x2) / 2
      connect(x1, top + 0.5cm, x2 - 0.05cm, top + 0.5cm)
      arrow-head(x2, top + 0.5cm, "right")
      place(
        dx: mid - 0.8cm,
        dy: top - 0.36cm,
        box(width: 1.6cm, align(center, text(size: 7pt, fill: luma(40%), arrow-labels.at(i)))),
      )
    }
    let errors = ([Coverage \ bias], [Sampling \ variance], [Nonresponse \ bias])
    for i in range(3) {
      let cx = (xs.at(i) + 2.3cm + xs.at(i + 1)) / 2
      node(cx - 1.15cm, 2.65cm, 2.3cm, 1.0cm, errors.at(i), fill: series-b.lighten(90%))
      connect(cx, 2.6cm, cx, top + 1.08cm, stroke: (paint: luma(45%), thickness: 0.6pt, dash: "dotted"))
      arrow-head(cx, top + 1.06cm, "up", size: 3.2pt)
    }
  }),
  caption: [The inference chain. Solid arrows carry data, dotted arrows mark
  where an error term enters. Only the sampling variance is reduced by
  collecting more rows.],
) <fig:chain>

=== Choosing a design

@tab:designs summarises the four designs that account for most practical work.
The column that matters in production is the last one, because a design whose
inclusion probabilities cannot be reconstructed from the stored data is a design
whose estimates cannot be corrected six months later.

#figure(
  book-table(
    columns: (auto, 1fr, auto, auto),
    align: (left, left, center, center),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Design*], [*Inclusion probability*], [*Typical deff*], [*Recoverable*],
    ),
    table.hline(stroke: 0.5pt),
    [Simple random], [$pi_i = n slash N$], [1.00], [Yes],
    [Stratified proportional], [$pi_i = n_h slash N_h$], [0.85 to 0.95], [Yes],
    [Cluster, two stage], [$pi_i = pi_"psu" dot pi_(i|"psu")$], [1.6 to 3.0], [Yes],
    [Convenience log], [unknown], [2.0 to 12.0], [No],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Designs ordered by how much of the inclusion mechanism survives into
  the stored table. Design effect ranges are typical values observed across our
  own panel studies, not universal constants.],
) <tab:designs>

The following routine computes a Horvitz-Thompson mean and its variance under a
stratified design, and it deliberately fails loudly rather than silently
imputing an inclusion probability it cannot justify.

```python
import numpy as np


def horvitz_thompson(values, inclusion, strata, population_size):
    values = np.asarray(values, dtype=float)
    inclusion = np.asarray(inclusion, dtype=float)
    if np.any(inclusion <= 0.0):
        raise ValueError("design is not measurable: pi_i <= 0 for some unit")

    weights = 1.0 / inclusion
    total = float(np.sum(weights * values))
    mean = total / population_size

    variance = 0.0
    for stratum in np.unique(strata):
        mask = strata == stratum
        n_h = int(mask.sum())
        if n_h < 2:
            raise ValueError(f"stratum {stratum!r} has {n_h} unit, cannot estimate variance")
        contribution = weights[mask] * values[mask]
        variance += n_h * contribution.var(ddof=1)

    return mean, variance / population_size ** 2
```

The `ddof=1` and the guard on singleton strata are the two lines that get
dropped when this code is rewritten under deadline, and they are the two lines
that keep the variance estimate from being biased downward.

== Nonresponse and calibration

Nonresponse converts a known design into an unknown one. The realised sample is
$s_r subset.eq s$, and the effective inclusion probability becomes
$pi_i dot rho_i$ where $rho_i$ is an unobserved response propensity. Calibration
estimators repair this by forcing the weighted sample to reproduce known
population margins @deville1992calibration. Given design weights $d_i = 1 slash pi_i$
and auxiliary totals $t_x$, we seek weights $w_i$ solving

$ min_(w) sum_(i in s_r) d_i G(w_i / d_i) quad "subject to" quad sum_(i in s_r) w_i x_i = t_x, $ <eq:calib>

where $G$ is a convex distance with $G(1) = 0$. Taking $G(u) = (u - 1)^2 slash 2$
recovers the linear regression estimator, and taking $G(u) = u log u - u + 1$
recovers raking. The choice matters less than the auxiliary variables: a
calibration on margins uncorrelated with the outcome buys nothing and inflates
the weight variance.

#remark[
  Calibration is not a correction for undercoverage. It repairs the composition
  of the covered part of the frame. If a group is absent from $F$ entirely, no
  reweighting of the units that are present can represent it, because the
  weights multiply rows that do not exist.
]

== Precision, design effect, and how many rows are enough

The design effect compares a design's variance against simple random sampling of
the same size @kish1965survey:

$ "deff" = (op("Var")_p (hat(theta))) / (op("Var")_"srs" (hat(theta))) approx 1 + "cv"^2(w), $ <eq:deff>

with $"cv"(w)$ the coefficient of variation of the final weights. The right-hand
approximation is the practically useful form, because it is computable from the
weight vector alone. It leads directly to the effective sample size
$n_"eff" = n slash "deff"$, which is the number that should appear in a power
calculation.

@tab:precision reports the half-width of a 95 percent interval for a proportion
near 0.30 at several sample sizes and design effects. The table makes the cost
of a ragged weight distribution concrete: a design effect of 2.5 removes roughly
sixty percent of the collected sample.

#figure(
  book-table(
    columns: (auto, auto, auto, auto, auto),
    align: (left, right, right, right, right),
    table.hline(stroke: 0.9pt),
    table.header(
      [*Nominal $n$*], [*deff 1.0*], [*deff 1.5*], [*deff 2.5*], [*$n_"eff"$ at 2.5*],
    ),
    table.hline(stroke: 0.5pt),
    [400], [4.49 pp], [5.50 pp], [7.10 pp], [160],
    [800], [3.18 pp], [3.89 pp], [5.02 pp], [320],
    [1600], [2.25 pp], [2.75 pp], [3.55 pp], [640],
    [3200], [1.59 pp], [1.94 pp], [2.51 pp], [1280],
    [6400], [1.12 pp], [1.37 pp], [1.78 pp], [2560],
    table.hline(stroke: 0.9pt),
  ),
  caption: [Half-width of a 95 percent interval for $p = 0.30$, in percentage
  points, against nominal sample size and design effect. Quadrupling the sample
  halves the interval; a design effect of 2.5 costs as much as discarding three
  fifths of it.],
) <tab:precision>

== Event logs are a sampling design in disguise

Most industrial data arrives as logs rather than surveys, and the temptation is
to treat a log as a census. It is not. A log records units that were exposed to
an instrumented surface, that loaded the instrumentation successfully, and that
did not exit before the event fired. Each condition is an inclusion filter, and
their product is an inclusion probability that nobody wrote down.

The remedy is not to abandon design thinking but to reconstruct the filters
explicitly. The routine below rebuilds an exposure denominator from a request
log, which is the minimum needed to convert an event count into a rate with a
defensible base.

```python
import pandas as pd


def exposure_adjusted_rate(events, requests, key="surface_id", window="7D"):
    exposed = (
        requests
        .query("rendered == True and instrumentation_ok == True")
        .set_index("timestamp")
        .groupby(key)
        .resample(window)
        .size()
        .rename("exposures")
    )
    observed = (
        events
        .set_index("timestamp")
        .groupby(key)
        .resample(window)
        .size()
        .rename("events")
    )
    joined = pd.concat([exposed, observed], axis=1).fillna({"events": 0})
    joined = joined[joined["exposures"] >= 30]
    joined["rate"] = joined["events"] / joined["exposures"]
    joined["se"] = (joined["rate"] * (1 - joined["rate"]) / joined["exposures"]) ** 0.5
    return joined.reset_index()
```

The `instrumentation_ok` filter is the one that changes conclusions. Sessions
whose instrumentation failed are not missing at random: they concentrate on
older devices and slower networks, which is also where the outcomes of interest
differ most. Dropping the filter inflates the denominator with sessions that
could not have produced an event, and the resulting rate understates the effect
on exactly the segment a product decision is likely to be about.

The threshold of thirty exposures deserves a word. It is not a significance
rule. It is a floor below which the normal approximation in the standard error
column stops being usable, and cells below it should be reported as counts
rather than rates. Chapter 2 takes up the question of how to describe such cells
without implying a precision the data cannot support.
